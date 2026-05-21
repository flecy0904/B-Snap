#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <PDFKit/PDFKit.h>
#import <React/RCTBridgeModule.h>
#import <CommonCrypto/CommonDigest.h>

@interface PdfPageRendererModule : NSObject <RCTBridgeModule>
@end

@implementation PdfPageRendererModule

RCT_EXPORT_MODULE(BsnPdfPageRenderer)

static NSInteger const BsnPdfCacheMetadataVersion = 1;
static NSString * const BsnPdfCacheMetadataKind = @"base";

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
}

RCT_EXPORT_METHOD(renderPage:(NSString *)fileUri
                  pageNumber:(nonnull NSNumber *)pageNumber
                  targetWidth:(nonnull NSNumber *)targetWidth
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (fileUri == nil || fileUri.length == 0) {
    reject(@"PDF_RENDER_INVALID_URI", @"PDF file URI is empty.", nil);
    return;
  }

  NSInteger requestedPageNumber = pageNumber.integerValue;
  if (requestedPageNumber < 1) {
    reject(@"PDF_RENDER_INVALID_PAGE", @"PDF pageNumber must start at 1.", nil);
    return;
  }

  NSInteger safeTargetWidth = MAX(1, targetWidth.integerValue);

  @try {
    NSString *outputPath = [self outputPathForFileUri:fileUri pageNumber:requestedPageNumber targetWidth:safeTargetWidth];
    NSDictionary<NSString *, id> *sourceFingerprint = [self sourceFingerprintForFileUri:fileUri];
    NSDictionary<NSString *, id> *cachedResult = sourceFingerprint != nil
      ? [self cachedPageResultAtPath:outputPath
                          pageNumber:requestedPageNumber
                         targetWidth:safeTargetWidth
                   sourceFingerprint:sourceFingerprint
                            pageCount:nil]
      : nil;
    if (cachedResult != nil) {
      [self prunePageImageCacheAtDirectory:outputPath.stringByDeletingLastPathComponent activePath:outputPath];
      resolve(cachedResult);
      return;
    }

    NSURL *fileURL = [self fileURLFromString:fileUri];
    if (fileURL == nil) {
      reject(@"PDF_RENDER_INVALID_URI", @"Only local file PDF URIs are supported.", nil);
      return;
    }

    if (![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
      reject(@"PDF_RENDER_INVALID_URI", @"PDF file does not exist.", nil);
      return;
    }

    PDFDocument *document = [[PDFDocument alloc] initWithURL:fileURL];
    if (document == nil) {
      reject(@"PDF_RENDER_FAILED", @"Cannot open PDF document.", nil);
      return;
    }

    NSInteger pageCount = document.pageCount;
    if (requestedPageNumber > pageCount) {
      reject(@"PDF_RENDER_PAGE_OUT_OF_RANGE", @"PDF pageNumber exceeds page count.", nil);
      return;
    }

    NSDictionary<NSString *, id> *fallbackCachedResult = [self cachedPageResultAtPath:outputPath
                                                                            pageNumber:requestedPageNumber
                                                                           targetWidth:safeTargetWidth
                                                                     sourceFingerprint:sourceFingerprint
                                                                            pageCount:@(pageCount)];
    if (fallbackCachedResult != nil) {
      [self prunePageImageCacheAtDirectory:outputPath.stringByDeletingLastPathComponent activePath:outputPath];
      resolve(fallbackCachedResult);
      return;
    }

    PDFPage *page = [document pageAtIndex:requestedPageNumber - 1];
    if (page == nil) {
      reject(@"PDF_RENDER_FAILED", @"Cannot open PDF page.", nil);
      return;
    }

    PDFDisplayBox displayBox = kPDFDisplayBoxCropBox;
    CGRect pageBounds = [page boundsForBox:displayBox];
    if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) {
      displayBox = kPDFDisplayBoxMediaBox;
      pageBounds = [page boundsForBox:displayBox];
    }
    if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) {
      reject(@"PDF_RENDER_FAILED", @"PDF page has invalid bounds.", nil);
      return;
    }

    CGFloat ratio = pageBounds.size.height / pageBounds.size.width;
    NSInteger bitmapWidth = safeTargetWidth;
    NSInteger bitmapHeight = MAX(1, (NSInteger)llround((CGFloat)bitmapWidth * ratio));

    UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
    format.opaque = YES;
    format.scale = 1.0;

    CGSize imageSize = CGSizeMake((CGFloat)bitmapWidth, (CGFloat)bitmapHeight);
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:imageSize format:format];
    UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull rendererContext) {
      CGContextRef context = rendererContext.CGContext;
      [[UIColor whiteColor] setFill];
      CGContextFillRect(context, CGRectMake(0, 0, imageSize.width, imageSize.height));

      CGContextSaveGState(context);
      CGContextTranslateCTM(context, 0, imageSize.height);
      CGContextScaleCTM(context, 1.0, -1.0);

      CGFloat scaleX = imageSize.width / pageBounds.size.width;
      CGFloat scaleY = imageSize.height / pageBounds.size.height;
      CGContextScaleCTM(context, scaleX, scaleY);
      CGContextTranslateCTM(context, -pageBounds.origin.x, -pageBounds.origin.y);

      [page drawWithBox:displayBox toContext:context];
      CGContextRestoreGState(context);
    }];

    NSData *pngData = UIImagePNGRepresentation(image);
    if (pngData == nil) {
      reject(@"PDF_RENDER_FAILED", @"Cannot encode PDF page image.", nil);
      return;
    }

    NSString *temporaryPath = [NSString stringWithFormat:@"%@.%@.tmp", outputPath, [NSUUID UUID].UUIDString];
    NSString *outputDirectory = outputPath.stringByDeletingLastPathComponent;
    NSError *directoryError = nil;
    [[NSFileManager defaultManager] createDirectoryAtPath:outputDirectory withIntermediateDirectories:YES attributes:nil error:&directoryError];
    if (directoryError != nil) {
      reject(@"PDF_RENDER_FAILED", directoryError.localizedDescription, directoryError);
      return;
    }

    NSError *writeError = nil;
    [pngData writeToFile:temporaryPath options:NSDataWritingAtomic error:&writeError];
    if (writeError != nil) {
      reject(@"PDF_RENDER_FAILED", writeError.localizedDescription, writeError);
      return;
    }

    NSFileManager *fileManager = [NSFileManager defaultManager];
    if ([fileManager fileExistsAtPath:outputPath]) {
      NSError *removeError = nil;
      [fileManager removeItemAtPath:outputPath error:&removeError];
      if (removeError != nil) {
        [fileManager removeItemAtPath:temporaryPath error:nil];
        reject(@"PDF_RENDER_FAILED", removeError.localizedDescription, removeError);
        return;
      }
    }

    NSError *moveError = nil;
    [fileManager moveItemAtPath:temporaryPath toPath:outputPath error:&moveError];
    if (moveError != nil) {
      [fileManager removeItemAtPath:temporaryPath error:nil];
      reject(@"PDF_RENDER_FAILED", moveError.localizedDescription, moveError);
      return;
    }

    [self writeCacheMetadataAtPath:outputPath
                        pageNumber:requestedPageNumber
                         pageCount:pageCount
                       targetWidth:bitmapWidth
                             width:bitmapWidth
                            height:bitmapHeight
                 sourceFingerprint:sourceFingerprint];
    [self prunePageImageCacheAtDirectory:outputDirectory activePath:outputPath];

    NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
    NSDictionary<NSFileAttributeKey, id> *attributes = [fileManager attributesOfItemAtPath:outputPath error:nil];
    NSDate *modifiedAt = attributes[NSFileModificationDate];
    NSString *outputUri = [NSString stringWithFormat:@"%@?v=%@", outputURL.absoluteString, @((long long)(modifiedAt.timeIntervalSince1970 * 1000))];

    resolve(@{
      @"uri": outputUri,
      @"width": @(bitmapWidth),
      @"height": @(bitmapHeight),
      @"pageNumber": @(requestedPageNumber),
      @"pageCount": @(pageCount),
    });
  } @catch (NSException *exception) {
    NSString *message = exception.reason ?: @"PDF page rendering failed.";
    reject(@"PDF_RENDER_FAILED", message, nil);
  }
}

- (NSURL *)fileURLFromString:(NSString *)fileUri
{
  NSURL *url = [NSURL URLWithString:fileUri];
  if (url != nil && url.isFileURL) {
    return url;
  }

  if (url != nil && url.scheme.length > 0) {
    return nil;
  }

  NSString *decodedPath = [fileUri stringByRemovingPercentEncoding] ?: fileUri;
  return [NSURL fileURLWithPath:decodedPath];
}

- (NSString *)outputPathForFileUri:(NSString *)fileUri pageNumber:(NSInteger)pageNumber targetWidth:(NSInteger)targetWidth
{
  NSArray<NSURL *> *cacheDirectories = [[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask];
  NSURL *cacheDirectory = cacheDirectories.firstObject ?: [NSURL fileURLWithPath:NSTemporaryDirectory()];
  NSString *cacheKey = [self sha1:[NSString stringWithFormat:@"%@:%ld:%ld", fileUri, (long)pageNumber, (long)targetWidth]];
  return [[cacheDirectory URLByAppendingPathComponent:@"bsnap-pdf-pages" isDirectory:YES] URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.png", cacheKey]].path;
}

- (NSDictionary<NSString *, id> *)sourceFingerprintForFileUri:(NSString *)fileUri
{
  NSURL *fileURL = [self fileURLFromString:fileUri];
  if (fileURL == nil || !fileURL.isFileURL) return nil;

  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSDictionary<NSFileAttributeKey, id> *attributes = [fileManager attributesOfItemAtPath:fileURL.path error:nil];
  if (attributes == nil) return nil;

  NSNumber *fileSize = attributes[NSFileSize];
  NSDate *modifiedAt = attributes[NSFileModificationDate];
  if (fileSize == nil || modifiedAt == nil) return nil;

  return @{
    @"key": [self sha1:fileURL.path],
    @"size": fileSize,
    @"modifiedAt": @((long long)(modifiedAt.timeIntervalSince1970 * 1000)),
  };
}

- (NSString *)metadataPathForOutputPath:(NSString *)outputPath
{
  NSString *directory = outputPath.stringByDeletingLastPathComponent;
  NSString *baseName = outputPath.lastPathComponent.stringByDeletingPathExtension;
  return [directory stringByAppendingPathComponent:[NSString stringWithFormat:@"%@.json", baseName]];
}

- (NSDictionary<NSString *, id> *)cachedPageResultAtPath:(NSString *)outputPath
                                              pageNumber:(NSInteger)pageNumber
                                             targetWidth:(NSInteger)targetWidth
                                       sourceFingerprint:(NSDictionary<NSString *, id> *)sourceFingerprint
                                               pageCount:(NSNumber *)pageCount
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSString *metadataPath = [self metadataPathForOutputPath:outputPath];
  if (![fileManager fileExistsAtPath:outputPath] || ![fileManager fileExistsAtPath:metadataPath]) {
    return nil;
  }

  NSData *metadataData = [NSData dataWithContentsOfFile:metadataPath];
  if (metadataData == nil) return nil;

  NSError *jsonError = nil;
  NSDictionary<NSString *, id> *metadata = [NSJSONSerialization JSONObjectWithData:metadataData options:0 error:&jsonError];
  if (jsonError != nil || ![metadata isKindOfClass:NSDictionary.class]) return nil;

  if ([metadata[@"version"] integerValue] != BsnPdfCacheMetadataVersion) return nil;
  if (![metadata[@"kind"] isEqualToString:BsnPdfCacheMetadataKind]) return nil;
  if ([metadata[@"pageNumber"] integerValue] != pageNumber) return nil;
  if ([metadata[@"pageCount"] integerValue] <= 0) return nil;
  if (pageCount != nil && [metadata[@"pageCount"] integerValue] != pageCount.integerValue) return nil;
  if ([metadata[@"targetWidth"] integerValue] != targetWidth) return nil;
  if (![self isSourceFingerprintValidInMetadata:metadata
                              sourceFingerprint:sourceFingerprint
                               allowLegacyCache:pageCount != nil]) return nil;

  UIImage *image = [UIImage imageWithContentsOfFile:outputPath];
  if (image == nil) return nil;
  NSInteger width = (NSInteger)llround(image.size.width * image.scale);
  NSInteger height = (NSInteger)llround(image.size.height * image.scale);
  if (width <= 0 || height <= 0) return nil;
  if (width != [metadata[@"width"] integerValue] || height != [metadata[@"height"] integerValue]) return nil;

  NSMutableDictionary<NSString *, id> *nextMetadata = [metadata mutableCopy];
  long long now = (long long)(NSDate.date.timeIntervalSince1970 * 1000);
  nextMetadata[@"lastAccessedAt"] = @(now);
  if (sourceFingerprint != nil) {
    nextMetadata[@"sourceKey"] = sourceFingerprint[@"key"];
    nextMetadata[@"sourceSize"] = sourceFingerprint[@"size"];
    nextMetadata[@"sourceModifiedAt"] = sourceFingerprint[@"modifiedAt"];
  }
  NSData *nextData = [NSJSONSerialization dataWithJSONObject:nextMetadata options:0 error:nil];
  if (nextData != nil) {
    [nextData writeToFile:metadataPath atomically:YES];
  }
  [fileManager setAttributes:@{ NSFileModificationDate: NSDate.date } ofItemAtPath:outputPath error:nil];

  NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
  NSDictionary<NSFileAttributeKey, id> *attributes = [fileManager attributesOfItemAtPath:outputPath error:nil];
  NSDate *modifiedAt = attributes[NSFileModificationDate];
  NSString *outputUri = [NSString stringWithFormat:@"%@?v=%@", outputURL.absoluteString, @((long long)(modifiedAt.timeIntervalSince1970 * 1000))];

  return @{
    @"uri": outputUri,
    @"width": @(width),
    @"height": @(height),
    @"pageNumber": @(pageNumber),
    @"pageCount": metadata[@"pageCount"],
  };
}

- (BOOL)isSourceFingerprintValidInMetadata:(NSDictionary<NSString *, id> *)metadata
                         sourceFingerprint:(NSDictionary<NSString *, id> *)sourceFingerprint
                          allowLegacyCache:(BOOL)allowLegacyCache
{
  if (sourceFingerprint == nil) return YES;
  if (metadata[@"sourceKey"] == nil && metadata[@"sourceSize"] == nil && metadata[@"sourceModifiedAt"] == nil) {
    return allowLegacyCache;
  }
  return [metadata[@"sourceKey"] isEqualToString:sourceFingerprint[@"key"]]
    && [metadata[@"sourceSize"] longLongValue] == [sourceFingerprint[@"size"] longLongValue]
    && [metadata[@"sourceModifiedAt"] longLongValue] == [sourceFingerprint[@"modifiedAt"] longLongValue];
}

- (void)writeCacheMetadataAtPath:(NSString *)outputPath
                       pageNumber:(NSInteger)pageNumber
                        pageCount:(NSInteger)pageCount
                      targetWidth:(NSInteger)targetWidth
                            width:(NSInteger)width
                           height:(NSInteger)height
                sourceFingerprint:(NSDictionary<NSString *, id> *)sourceFingerprint
{
  long long now = (long long)(NSDate.date.timeIntervalSince1970 * 1000);
  NSMutableDictionary<NSString *, id> *metadata = [@{
    @"version": @(BsnPdfCacheMetadataVersion),
    @"kind": BsnPdfCacheMetadataKind,
    @"pageNumber": @(pageNumber),
    @"pageCount": @(pageCount),
    @"targetWidth": @(targetWidth),
    @"width": @(width),
    @"height": @(height),
    @"createdAt": @(now),
    @"lastAccessedAt": @(now),
  } mutableCopy];
  if (sourceFingerprint != nil) {
    metadata[@"sourceKey"] = sourceFingerprint[@"key"];
    metadata[@"sourceSize"] = sourceFingerprint[@"size"];
    metadata[@"sourceModifiedAt"] = sourceFingerprint[@"modifiedAt"];
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:metadata options:0 error:nil];
  if (data != nil) {
    [data writeToFile:[self metadataPathForOutputPath:outputPath] atomically:YES];
  }
}

- (void)prunePageImageCacheAtDirectory:(NSString *)directoryPath activePath:(NSString *)activePath
{
  static NSInteger const maxCachedPageImages = 11;
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSArray<NSString *> *fileNames = [fileManager contentsOfDirectoryAtPath:directoryPath error:nil] ?: @[];
  NSMutableArray<NSDictionary<NSString *, id> *> *images = [NSMutableArray array];

  for (NSString *fileName in fileNames) {
    if (![fileName.pathExtension.lowercaseString isEqualToString:@"png"]) continue;
    NSString *path = [directoryPath stringByAppendingPathComponent:fileName];
    NSDictionary<NSFileAttributeKey, id> *attributes = [fileManager attributesOfItemAtPath:path error:nil];
    NSDate *modifiedAt = attributes[NSFileModificationDate] ?: [NSDate distantPast];
    [images addObject:@{ @"path": path, @"modifiedAt": modifiedAt }];
  }

  if (images.count <= maxCachedPageImages) return;

  [images sortUsingComparator:^NSComparisonResult(NSDictionary<NSString *, id> *first, NSDictionary<NSString *, id> *second) {
    return [((NSDate *)second[@"modifiedAt"]) compare:(NSDate *)first[@"modifiedAt"]];
  }];

  NSInteger keptCount = 0;
  for (NSDictionary<NSString *, id> *entry in images) {
    NSString *path = (NSString *)entry[@"path"];
    if ([path isEqualToString:activePath]) {
      keptCount += 1;
      continue;
    }
    if (keptCount < maxCachedPageImages) {
      keptCount += 1;
      continue;
    }
    [fileManager removeItemAtPath:[self metadataPathForOutputPath:path] error:nil];
    [fileManager removeItemAtPath:path error:nil];
  }
}

- (NSString *)sha1:(NSString *)value
{
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(data.bytes, (CC_LONG)data.length, digest);

  NSMutableString *result = [NSMutableString stringWithCapacity:CC_SHA1_DIGEST_LENGTH * 2];
  for (NSInteger index = 0; index < CC_SHA1_DIGEST_LENGTH; index += 1) {
    [result appendFormat:@"%02x", digest[index]];
  }
  return result;
}

@end
