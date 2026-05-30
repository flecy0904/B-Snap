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

RCT_EXPORT_METHOD(renderSelectionPreview:(NSString *)fileUri
                  pageNumber:(nonnull NSNumber *)pageNumber
                  rect:(NSDictionary *)rect
                  targetWidth:(nonnull NSNumber *)targetWidth
                  inkStrokes:(NSArray *)inkStrokes
                  textAnnotations:(NSArray *)textAnnotations
                  imageAnnotations:(NSArray *)imageAnnotations
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

  CGFloat selectionX = [rect[@"x"] doubleValue];
  CGFloat selectionY = [rect[@"y"] doubleValue];
  CGFloat selectionWidth = [rect[@"width"] doubleValue];
  CGFloat selectionHeight = [rect[@"height"] doubleValue];
  CGFloat logicalPageWidth = MAX(1.0, [rect[@"pageWidth"] doubleValue]);
  CGFloat logicalPageHeight = MAX(1.0, [rect[@"pageHeight"] doubleValue]);
  if (selectionWidth <= 0 || selectionHeight <= 0) {
    reject(@"PDF_RENDER_INVALID_SELECTION", @"Selection rect is empty.", nil);
    return;
  }

  NSURL *fileURL = [self fileURLFromString:fileUri];
  if (fileURL == nil || ![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
    reject(@"PDF_RENDER_INVALID_URI", @"PDF file does not exist.", nil);
    return;
  }

  PDFDocument *document = [[PDFDocument alloc] initWithURL:fileURL];
  if (document == nil || requestedPageNumber > document.pageCount) {
    reject(@"PDF_RENDER_FAILED", @"Cannot open PDF page.", nil);
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

  NSInteger bitmapWidth = MAX(1, targetWidth.integerValue);
  NSInteger bitmapHeight = MAX(1, (NSInteger)llround((CGFloat)bitmapWidth * selectionHeight / MAX(1.0, selectionWidth)));
  CGSize imageSize = CGSizeMake((CGFloat)bitmapWidth, (CGFloat)bitmapHeight);

  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.opaque = YES;
  format.scale = 1.0;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:imageSize format:format];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull rendererContext) {
    CGContextRef context = rendererContext.CGContext;
    [[UIColor whiteColor] setFill];
    CGContextFillRect(context, CGRectMake(0, 0, imageSize.width, imageSize.height));

    CGFloat scale = imageSize.width / MAX(1.0, selectionWidth);
    CGContextSaveGState(context);
    CGContextScaleCTM(context, scale, scale);
    CGContextTranslateCTM(context, -selectionX, -selectionY);

    CGContextSaveGState(context);
    CGContextTranslateCTM(context, 0, logicalPageHeight);
    CGContextScaleCTM(context, 1.0, -1.0);
    CGContextScaleCTM(context, logicalPageWidth / pageBounds.size.width, logicalPageHeight / pageBounds.size.height);
    CGContextTranslateCTM(context, -pageBounds.origin.x, -pageBounds.origin.y);
    [page drawWithBox:displayBox toContext:context];
    CGContextRestoreGState(context);

    [self drawImageAnnotations:imageAnnotations
                     pageNumber:requestedPageNumber
               logicalPageWidth:logicalPageWidth
              logicalPageHeight:logicalPageHeight
                        context:context];
    [self drawInkStrokes:inkStrokes
              pageNumber:requestedPageNumber
        logicalPageWidth:logicalPageWidth
       logicalPageHeight:logicalPageHeight
                 context:context];
    [self drawTextAnnotations:textAnnotations
                   pageNumber:requestedPageNumber
             logicalPageWidth:logicalPageWidth
            logicalPageHeight:logicalPageHeight
                      context:context];
    CGContextRestoreGState(context);
  }];

  NSData *pngData = UIImagePNGRepresentation(image);
  if (pngData == nil) {
    reject(@"PDF_RENDER_FAILED", @"Cannot encode PDF selection image.", nil);
    return;
  }

  NSArray<NSURL *> *cacheDirectories = [[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask];
  NSURL *cacheDirectory = cacheDirectories.firstObject ?: [NSURL fileURLWithPath:NSTemporaryDirectory()];
  NSURL *outputDirectory = [cacheDirectory URLByAppendingPathComponent:@"bsnap-pdf-selections" isDirectory:YES];
  NSError *directoryError = nil;
  [[NSFileManager defaultManager] createDirectoryAtURL:outputDirectory withIntermediateDirectories:YES attributes:nil error:&directoryError];
  if (directoryError != nil) {
    reject(@"PDF_RENDER_FAILED", directoryError.localizedDescription, directoryError);
    return;
  }

  NSURL *outputURL = [outputDirectory URLByAppendingPathComponent:[NSString stringWithFormat:@"selection-%lld-%@.png", (long long)(NSDate.date.timeIntervalSince1970 * 1000), NSUUID.UUID.UUIDString]];
  NSError *writeError = nil;
  [pngData writeToURL:outputURL options:NSDataWritingAtomic error:&writeError];
  if (writeError != nil) {
    reject(@"PDF_RENDER_FAILED", writeError.localizedDescription, writeError);
    return;
  }
  [self pruneSelectionPreviewImagesAtDirectory:outputDirectory.path activePath:outputURL.path];

  resolve(@{
    @"uri": outputURL.absoluteString,
    @"width": @(bitmapWidth),
    @"height": @(bitmapHeight),
    @"pageNumber": @(requestedPageNumber),
    @"pageCount": @(document.pageCount),
  });
}

- (void)pruneSelectionPreviewImagesAtDirectory:(NSString *)directoryPath activePath:(NSString *)activePath
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSArray<NSString *> *fileNames = [fileManager contentsOfDirectoryAtPath:directoryPath error:nil];
  if (fileNames.count <= 24) return;

  NSMutableArray<NSDictionary<NSString *, id> *> *images = [NSMutableArray array];
  for (NSString *fileName in fileNames) {
    if (![fileName.pathExtension.lowercaseString isEqualToString:@"png"]) continue;
    NSString *path = [directoryPath stringByAppendingPathComponent:fileName];
    NSDictionary<NSFileAttributeKey, id> *attributes = [fileManager attributesOfItemAtPath:path error:nil];
    NSDate *modifiedAt = attributes[NSFileModificationDate] ?: NSDate.distantPast;
    [images addObject:@{ @"path": path, @"modifiedAt": modifiedAt }];
  }

  [images sortUsingComparator:^NSComparisonResult(NSDictionary<NSString *, id> *first, NSDictionary<NSString *, id> *second) {
    return [(NSDate *)second[@"modifiedAt"] compare:(NSDate *)first[@"modifiedAt"]];
  }];

  for (NSUInteger index = 0; index < images.count; index += 1) {
    NSString *path = (NSString *)images[index][@"path"];
    if ([path isEqualToString:activePath]) continue;
    if (index < 24) continue;
    [fileManager removeItemAtPath:path error:nil];
  }
}

- (CGFloat)safeDouble:(id)value fallback:(CGFloat)fallback
{
  if ([value respondsToSelector:@selector(doubleValue)]) return MAX(1.0, [value doubleValue]);
  return MAX(1.0, fallback);
}

- (CGPoint)mapLogicalPoint:(NSDictionary *)point
                sourcePage:(NSDictionary *)source
          logicalPageWidth:(CGFloat)logicalPageWidth
         logicalPageHeight:(CGFloat)logicalPageHeight
{
  CGFloat sourcePageWidth = [self safeDouble:point[@"pageWidth"] fallback:[self safeDouble:source[@"pageWidth"] fallback:logicalPageWidth]];
  CGFloat sourcePageHeight = [self safeDouble:point[@"pageHeight"] fallback:[self safeDouble:source[@"pageHeight"] fallback:logicalPageHeight]];
  return CGPointMake(
    [point[@"x"] doubleValue] / sourcePageWidth * logicalPageWidth,
    [point[@"y"] doubleValue] / sourcePageHeight * logicalPageHeight
  );
}

- (CGFloat)logicalScaleForSource:(NSDictionary *)source
                logicalPageWidth:(CGFloat)logicalPageWidth
               logicalPageHeight:(CGFloat)logicalPageHeight
{
  CGFloat sourcePageWidth = [self safeDouble:source[@"pageWidth"] fallback:logicalPageWidth];
  CGFloat sourcePageHeight = [self safeDouble:source[@"pageHeight"] fallback:logicalPageHeight];
  return ((logicalPageWidth / sourcePageWidth) + (logicalPageHeight / sourcePageHeight)) * 0.5;
}

- (nullable UIImage *)decodeImageAnnotationUri:(NSString *)uri
{
  if (uri.length == 0) return nil;
  if ([uri hasPrefix:@"file://"]) {
    NSURL *url = [NSURL URLWithString:uri];
    return url.path.length ? [UIImage imageWithContentsOfFile:url.path] : nil;
  }
  if ([uri hasPrefix:@"data:image/"]) {
    NSRange comma = [uri rangeOfString:@","];
    if (comma.location == NSNotFound) return nil;
    NSString *payload = [uri substringFromIndex:comma.location + 1];
    NSData *data = [[NSData alloc] initWithBase64EncodedString:payload options:NSDataBase64DecodingIgnoreUnknownCharacters];
    return data.length ? [UIImage imageWithData:data] : nil;
  }
  if ([uri hasPrefix:@"http://"] || [uri hasPrefix:@"https://"]) {
    NSURL *url = [NSURL URLWithString:uri];
    if (url == nil) return nil;
    NSData *data = [NSData dataWithContentsOfURL:url];
    return data.length ? [UIImage imageWithData:data] : nil;
  }
  return [UIImage imageWithContentsOfFile:uri];
}

- (void)drawImageAnnotations:(NSArray *)imageAnnotations
                  pageNumber:(NSInteger)pageNumber
            logicalPageWidth:(CGFloat)logicalPageWidth
           logicalPageHeight:(CGFloat)logicalPageHeight
                     context:(CGContextRef)context
{
  if (![imageAnnotations isKindOfClass:NSArray.class]) return;
  NSArray<NSDictionary *> *sortedAnnotations = [imageAnnotations sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    NSInteger leftZ = left[@"zIndex"] != nil ? [left[@"zIndex"] integerValue] : 0;
    NSInteger rightZ = right[@"zIndex"] != nil ? [right[@"zIndex"] integerValue] : 0;
    if (leftZ == rightZ) return NSOrderedSame;
    return leftZ < rightZ ? NSOrderedAscending : NSOrderedDescending;
  }];

  for (NSDictionary *annotation in sortedAnnotations) {
    if (![annotation isKindOfClass:NSDictionary.class]) continue;
    NSNumber *annotationPageNumber = annotation[@"pageNumber"];
    if (annotationPageNumber == nil || annotationPageNumber.integerValue != pageNumber) continue;
    NSString *uri = [annotation[@"uri"] isKindOfClass:NSString.class] ? annotation[@"uri"] : @"";
    UIImage *image = [self decodeImageAnnotationUri:uri];
    if (image == nil) continue;

    CGFloat sourcePageWidth = [self safeDouble:annotation[@"pageWidth"] fallback:logicalPageWidth];
    CGFloat sourcePageHeight = [self safeDouble:annotation[@"pageHeight"] fallback:logicalPageHeight];
    CGFloat scaleX = logicalPageWidth / sourcePageWidth;
    CGFloat scaleY = logicalPageHeight / sourcePageHeight;
    CGRect frame = CGRectMake(
      [annotation[@"x"] doubleValue] * scaleX,
      [annotation[@"y"] doubleValue] * scaleY,
      MAX(1.0, [annotation[@"width"] doubleValue] * scaleX),
      MAX(1.0, [annotation[@"height"] doubleValue] * scaleY)
    );
    CGFloat opacity = annotation[@"opacity"] != nil ? MIN(1.0, MAX(0.05, [annotation[@"opacity"] doubleValue])) : 1.0;
    CGFloat rotation = annotation[@"rotation"] != nil ? [annotation[@"rotation"] doubleValue] : 0.0;

    CGContextSaveGState(context);
    if (fabs(rotation) > 0.01) {
      CGPoint center = CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame));
      CGContextTranslateCTM(context, center.x, center.y);
      CGContextRotateCTM(context, rotation * M_PI / 180.0);
      frame = CGRectMake(-frame.size.width * 0.5, -frame.size.height * 0.5, frame.size.width, frame.size.height);
    }
    [image drawInRect:frame blendMode:kCGBlendModeNormal alpha:opacity];
    CGContextRestoreGState(context);
  }
}

- (void)drawInkStrokes:(NSArray *)inkStrokes
            pageNumber:(NSInteger)pageNumber
      logicalPageWidth:(CGFloat)logicalPageWidth
     logicalPageHeight:(CGFloat)logicalPageHeight
               context:(CGContextRef)context
{
  if (![inkStrokes isKindOfClass:NSArray.class]) return;
  for (NSDictionary *stroke in inkStrokes) {
    if (![stroke isKindOfClass:NSDictionary.class]) continue;
    NSNumber *strokePageNumber = stroke[@"pageNumber"];
    if (strokePageNumber == nil || strokePageNumber.integerValue != pageNumber) continue;
    NSArray *points = stroke[@"points"];
    if (![points isKindOfClass:NSArray.class] || points.count == 0) continue;

    UIColor *color = [self colorFromHex:stroke[@"color"] ?: @"#111827"];
    NSString *style = [stroke[@"style"] isKindOfClass:NSString.class] ? stroke[@"style"] : @"pen";
    CGFloat width = MAX(1.0, [stroke[@"width"] doubleValue] * [self logicalScaleForSource:stroke logicalPageWidth:logicalPageWidth logicalPageHeight:logicalPageHeight]);
    CGContextSaveGState(context);
    CGContextSetStrokeColorWithColor(context, [color colorWithAlphaComponent:[style isEqualToString:@"highlight"] ? 0.36 : 1.0].CGColor);
    CGContextSetLineWidth(context, width);
    CGContextSetLineCap(context, kCGLineCapRound);
    CGContextSetLineJoin(context, kCGLineJoinRound);

    NSString *linePattern = [stroke[@"linePattern"] isKindOfClass:NSString.class] ? stroke[@"linePattern"] : @"solid";
    if ([linePattern isEqualToString:@"dashed"]) {
      CGFloat lengths[] = { width * 4.0, width * 2.5 };
      CGContextSetLineDash(context, 0, lengths, 2);
    } else if ([linePattern isEqualToString:@"dotted"]) {
      CGFloat lengths[] = { width, width * 1.8 };
      CGContextSetLineDash(context, 0, lengths, 2);
    }

    if ([style isEqualToString:@"shape"] && points.count >= 2) {
      NSDictionary *start = points.firstObject;
      NSDictionary *end = points.lastObject;
      NSString *shape = [stroke[@"shape"] isKindOfClass:NSString.class] ? stroke[@"shape"] : @"line";
      CGPoint mappedStart = [self mapLogicalPoint:start sourcePage:stroke logicalPageWidth:logicalPageWidth logicalPageHeight:logicalPageHeight];
      CGPoint mappedEnd = [self mapLogicalPoint:end sourcePage:stroke logicalPageWidth:logicalPageWidth logicalPageHeight:logicalPageHeight];
      CGFloat x1 = mappedStart.x;
      CGFloat y1 = mappedStart.y;
      CGFloat x2 = mappedEnd.x;
      CGFloat y2 = mappedEnd.y;
      CGRect shapeRect = CGRectMake(MIN(x1, x2), MIN(y1, y2), fabs(x2 - x1), fabs(y2 - y1));
      if ([shape isEqualToString:@"rect"]) {
        CGContextStrokeRect(context, shapeRect);
      } else if ([shape isEqualToString:@"ellipse"]) {
        CGContextStrokeEllipseInRect(context, shapeRect);
      } else {
        CGContextMoveToPoint(context, x1, y1);
        CGContextAddLineToPoint(context, x2, y2);
        CGContextStrokePath(context);
        if ([shape isEqualToString:@"arrow"]) [self drawArrowFrom:CGPointMake(x1, y1) to:CGPointMake(x2, y2) context:context width:width];
      }
      CGContextRestoreGState(context);
      continue;
    }

    for (NSInteger index = 0; index < points.count; index += 1) {
      NSDictionary *point = points[index];
      CGPoint mapped = [self mapLogicalPoint:point sourcePage:stroke logicalPageWidth:logicalPageWidth logicalPageHeight:logicalPageHeight];
      if (index == 0) CGContextMoveToPoint(context, mapped.x, mapped.y); else CGContextAddLineToPoint(context, mapped.x, mapped.y);
    }
    CGContextStrokePath(context);
    CGContextRestoreGState(context);
  }
}

- (void)drawTextAnnotations:(NSArray *)textAnnotations
                 pageNumber:(NSInteger)pageNumber
           logicalPageWidth:(CGFloat)logicalPageWidth
          logicalPageHeight:(CGFloat)logicalPageHeight
                    context:(CGContextRef)context
{
  if (![textAnnotations isKindOfClass:NSArray.class]) return;
  for (NSDictionary *annotation in textAnnotations) {
    if (![annotation isKindOfClass:NSDictionary.class]) continue;
    NSNumber *annotationPageNumber = annotation[@"pageNumber"];
    if (annotationPageNumber == nil || annotationPageNumber.integerValue != pageNumber) continue;
    NSString *text = [annotation[@"text"] isKindOfClass:NSString.class] ? annotation[@"text"] : @"";
    if (text.length == 0) continue;
    NSNumber *heightValue = annotation[@"height"];
    NSNumber *fontSizeValue = annotation[@"fontSize"];
    CGFloat sourcePageWidth = [self safeDouble:annotation[@"pageWidth"] fallback:logicalPageWidth];
    CGFloat sourcePageHeight = [self safeDouble:annotation[@"pageHeight"] fallback:logicalPageHeight];
    CGFloat scaleX = logicalPageWidth / sourcePageWidth;
    CGFloat scaleY = logicalPageHeight / sourcePageHeight;
    CGFloat annotationHeight = heightValue != nil ? heightValue.doubleValue : 88.0;
    CGFloat scale = (scaleX + scaleY) * 0.5;
    CGFloat fontSize = (fontSizeValue != nil ? MAX(12.0, MIN(40.0, fontSizeValue.doubleValue)) : 17.0) * scale;
    CGRect frame = CGRectMake(
      [annotation[@"x"] doubleValue] * scaleX,
      [annotation[@"y"] doubleValue] * scaleY,
      MAX(1.0, [annotation[@"width"] doubleValue] * scaleX),
      MAX(32.0, annotationHeight * scaleY)
    );
    UIColor *color = [self colorFromHex:annotation[@"color"] ?: @"#111827"];
    [[UIColor colorWithWhite:1.0 alpha:0.92] setFill];
    UIBezierPath *backgroundPath = [UIBezierPath bezierPathWithRoundedRect:frame cornerRadius:5.0 * scale];
    [backgroundPath fill];
    [[UIColor colorWithRed:0.78 green:0.82 blue:0.90 alpha:0.82] setStroke];
    backgroundPath.lineWidth = MAX(0.7, 1.0 * scale);
    [backgroundPath stroke];
    NSDictionary *attrs = @{
      NSFontAttributeName: [UIFont systemFontOfSize:MAX(8.0, fontSize) weight:UIFontWeightSemibold],
      NSForegroundColorAttributeName: color,
    };
    [text drawInRect:CGRectInset(frame, 8 * scale, 6 * scale) withAttributes:attrs];
  }
}

- (void)drawArrowFrom:(CGPoint)start to:(CGPoint)end context:(CGContextRef)context width:(CGFloat)width
{
  CGFloat angle = atan2(end.y - start.y, end.x - start.x);
  CGFloat length = MAX(10.0, width * 4.0);
  CGPoint left = CGPointMake(end.x + cos(angle + M_PI * 0.82) * length, end.y + sin(angle + M_PI * 0.82) * length);
  CGPoint right = CGPointMake(end.x + cos(angle - M_PI * 0.82) * length, end.y + sin(angle - M_PI * 0.82) * length);
  CGContextMoveToPoint(context, end.x, end.y);
  CGContextAddLineToPoint(context, left.x, left.y);
  CGContextMoveToPoint(context, end.x, end.y);
  CGContextAddLineToPoint(context, right.x, right.y);
  CGContextStrokePath(context);
}

- (UIColor *)colorFromHex:(NSString *)hex
{
  NSString *clean = [[hex stringByReplacingOccurrencesOfString:@"#" withString:@""] uppercaseString];
  if (clean.length != 6) return UIColor.blackColor;
  unsigned int rgb = 0;
  [[NSScanner scannerWithString:clean] scanHexInt:&rgb];
  return [UIColor colorWithRed:((rgb >> 16) & 0xFF) / 255.0
                         green:((rgb >> 8) & 0xFF) / 255.0
                          blue:(rgb & 0xFF) / 255.0
                         alpha:1.0];
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
