#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <PDFKit/PDFKit.h>
#import <React/RCTBridgeModule.h>
#import <CommonCrypto/CommonDigest.h>

@interface PdfPageRendererModule : NSObject <RCTBridgeModule>
@end

@implementation PdfPageRendererModule

RCT_EXPORT_MODULE(BsnPdfPageRenderer)

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

    NSString *outputPath = [self outputPathForFileUri:fileUri pageNumber:requestedPageNumber targetWidth:bitmapWidth];
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
