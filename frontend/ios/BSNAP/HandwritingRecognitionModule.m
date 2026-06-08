#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

#if __has_include(<MLKitDigitalInkRecognition/MLKitDigitalInkRecognition.h>) && __has_include(<MLKitCommon/MLKitCommon.h>)
#import <MLKitCommon/MLKitCommon.h>
#import <MLKitDigitalInkRecognition/MLKitDigitalInkRecognition.h>
#define BSNAP_HAS_MLKIT_DIGITAL_INK 1
#else
#define BSNAP_HAS_MLKIT_DIGITAL_INK 0
#endif

@interface HandwritingRecognitionModule : NSObject <RCTBridgeModule>
@end

@interface HandwritingRecognitionModule ()
#if BSNAP_HAS_MLKIT_DIGITAL_INK
@property(nonatomic, strong) MLKDigitalInkRecognitionModelIdentifier *koreanModelIdentifier;
@property(nonatomic, strong) MLKDigitalInkRecognitionModel *koreanModel;
@property(nonatomic, strong) MLKModelManager *koreanModelManager;
@property(nonatomic, strong) MLKDigitalInkRecognizer *koreanRecognizer;
@property(nonatomic, strong) NSProgress *koreanModelDownloadProgress;
@property(nonatomic, copy) NSString *koreanModelDownloadState;
@property(nonatomic, copy) NSString *koreanModelDownloadDetail;
#endif
@end

@implementation HandwritingRecognitionModule

RCT_EXPORT_MODULE(BsnHandwritingRecognition)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
}

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
#if BSNAP_HAS_MLKIT_DIGITAL_INK
  NSDictionary *modelStatus = [self koreanModelStatus];
  resolve(@{
    @"available": @YES,
    @"detail": [NSString stringWithFormat:@"ML Kit Digital Ink bridge is installed. Korean model state: %@.", modelStatus[@"state"] ?: @"unknown"],
    @"state": modelStatus[@"state"] ?: @"unknown",
  });
#else
  resolve(@{@"available": @NO, @"detail": @"GoogleMLKit/DigitalInkRecognition is not installed. Run pod install for a development build."});
#endif
}

RCT_EXPORT_METHOD(ensureKoreanModel:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
#if BSNAP_HAS_MLKIT_DIGITAL_INK
  MLKDigitalInkRecognitionModel *model = [self koreanDigitalInkModel];
  if (model == nil) {
    resolve(@{@"available": @NO, @"state": @"failed", @"detail": @"Korean Digital Ink model identifier is unavailable."});
    return;
  }

  NSDictionary *currentStatus = [self koreanModelStatus];
  NSString *currentState = currentStatus[@"state"];
  if ([currentState isEqualToString:@"ready"]) {
    resolve(currentStatus);
    return;
  }
  if ([currentState isEqualToString:@"downloading"]) {
    resolve(currentStatus);
    return;
  }

  MLKModelDownloadConditions *conditions = [[MLKModelDownloadConditions alloc] initWithAllowsCellularAccess:YES
                                                                                 allowsBackgroundDownloading:YES];
  NSProgress *progress = [[self digitalInkModelManager] downloadModel:model conditions:conditions];
  if (progress == nil) {
    @synchronized(self) {
      self.koreanModelDownloadState = @"failed";
      self.koreanModelDownloadDetail = @"Korean Digital Ink model download could not be started.";
      self.koreanModelDownloadProgress = nil;
    }
    resolve(@{@"available": @NO, @"state": @"failed", @"detail": self.koreanModelDownloadDetail});
    return;
  }

  @synchronized(self) {
    self.koreanModelDownloadProgress = progress;
    self.koreanModelDownloadState = @"downloading";
    self.koreanModelDownloadDetail = @"Korean Digital Ink model download is in progress. Tap model prepare/check again after it finishes.";
  }
  resolve(@{@"available": @NO, @"state": @"downloading", @"detail": self.koreanModelDownloadDetail});
#else
  resolve(@{@"available": @NO, @"detail": @"GoogleMLKit/DigitalInkRecognition is not installed. Run pod install for a development build."});
#endif
}

RCT_EXPORT_METHOD(recognizeKoreanInk:(NSArray *)inkStrokes
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
#if BSNAP_HAS_MLKIT_DIGITAL_INK
  if (![inkStrokes isKindOfClass:[NSArray class]] || inkStrokes.count == 0) {
    resolve([self unavailableRecognitionWithDetail:@"No B-Snap ink strokes were provided."]);
    return;
  }

  MLKDigitalInkRecognitionModel *model = [self koreanDigitalInkModel];
  if (model == nil) {
    resolve([self unavailableRecognitionWithDetail:@"Korean Digital Ink model identifier is unavailable."]);
    return;
  }

  NSDictionary *modelStatus = [self koreanModelStatus];
  NSString *modelState = modelStatus[@"state"] ?: @"missing";
  if (![modelState isEqualToString:@"ready"]) {
    NSString *detail = modelStatus[@"detail"] ?: @"Korean Digital Ink model is missing. Run ensureKoreanModel first.";
    resolve([self unavailableRecognitionWithDetail:detail modelState:modelState]);
    return;
  }

  NSDictionary *inkPayload = [self inkFromBsnStrokes:inkStrokes];
  MLKInk *ink = inkPayload[@"ink"];
  NSNumber *strokeCount = inkPayload[@"strokeCount"] ?: @(0);
  if (ink == nil || strokeCount.integerValue == 0) {
    resolve([self unavailableRecognitionWithDetail:@"No eligible pen strokes were found on this B-Snap page."]);
    return;
  }

  MLKDigitalInkRecognizer *recognizer = [self koreanDigitalInkRecognizerWithModel:model];
  if (recognizer == nil) {
    resolve([self failedRecognitionWithDetail:@"Korean Digital Ink recognizer could not be created."]);
    return;
  }
  [recognizer recognizeInk:ink completion:^(MLKDigitalInkRecognitionResult *_Nullable result, NSError *_Nullable error) {
    (void)recognizer;
    if (error != nil) {
      resolve([self failedRecognitionWithDetail:error.localizedDescription ?: @"ML Kit recognition failed."]);
      return;
    }

    NSArray *candidates = [self candidatesFromRecognitionResult:result];
    NSString *text = candidates.count > 0 ? candidates[0][@"text"] : @"";
    double confidence = candidates.count > 0 ? 0.82 : 0.0;
    NSDictionary *bbox = inkPayload[@"bbox"] ?: @{@"x": @0, @"y": @0, @"width": @0, @"height": @0};
    NSNumber *pageNumber = inkPayload[@"pageNumber"] ?: @(1);
    NSDictionary *cluster = @{
      @"id": @"mlkit-cluster-1",
      @"pageNumber": pageNumber,
      @"bbox": bbox,
      @"text": text ?: @"",
      @"candidates": candidates,
      @"keywords": @[],
      @"symbols": @[],
      @"confidence": @(confidence),
      @"source": @"mlkit-digital-ink",
    };
    resolve(@{
      @"status": candidates.count > 0 ? @"ready" : @"unavailable",
      @"engine": @"mlkit-digital-ink",
      @"text": text ?: @"",
      @"keywords": @[],
      @"symbols": @[],
      @"confidence": @(confidence),
      @"clusters": candidates.count > 0 ? @[cluster] : @[],
      @"candidates": candidates,
      @"modelState": @"ready",
      @"detail": candidates.count > 0 ? @"ML Kit Digital Ink recognition completed." : @"ML Kit returned no candidates.",
    });
  }];
#else
  resolve([self unavailableRecognitionWithDetail:@"GoogleMLKit/DigitalInkRecognition is not installed. Run pod install for a development build."]);
#endif
}

RCT_EXPORT_METHOD(recognizeGestureInk:(NSArray *)inkStrokes
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@{
    @"status": @"unavailable",
    @"engine": @"mlkit-digital-ink",
    @"symbols": @[],
    @"confidence": @0,
    @"detail": @"ML Kit gesture bridge is not implemented in PR 5. Geometry symbol detection remains active.",
  });
}

#if BSNAP_HAS_MLKIT_DIGITAL_INK
- (MLKModelManager *)digitalInkModelManager
{
  @synchronized(self) {
    if (self.koreanModelManager == nil) {
      self.koreanModelManager = [MLKModelManager modelManager];
    }
    return self.koreanModelManager;
  }
}

- (MLKDigitalInkRecognitionModel *)koreanDigitalInkModel
{
  @synchronized(self) {
    if (self.koreanModel != nil) {
      return self.koreanModel;
    }
    if (self.koreanModelIdentifier == nil) {
      self.koreanModelIdentifier = [MLKDigitalInkRecognitionModelIdentifier modelIdentifierForLanguageTag:@"ko"];
    }
    if (self.koreanModelIdentifier == nil) {
      return nil;
    }
    self.koreanModel = [[MLKDigitalInkRecognitionModel alloc] initWithModelIdentifier:self.koreanModelIdentifier];
    return self.koreanModel;
  }
}

- (NSDictionary *)koreanModelStatus
{
  MLKDigitalInkRecognitionModel *model = [self koreanDigitalInkModel];
  if (model == nil) {
    @synchronized(self) {
      self.koreanModelDownloadState = @"failed";
      self.koreanModelDownloadDetail = @"Korean Digital Ink model identifier is unavailable.";
    }
    return @{@"available": @NO, @"state": @"failed", @"detail": self.koreanModelDownloadDetail};
  }

  MLKModelManager *modelManager = [self digitalInkModelManager];
  if ([modelManager isModelDownloaded:model]) {
    @synchronized(self) {
      self.koreanModelDownloadState = @"ready";
      self.koreanModelDownloadDetail = @"Korean Digital Ink model is ready.";
      self.koreanModelDownloadProgress = nil;
    }
    return @{@"available": @YES, @"state": @"ready", @"detail": self.koreanModelDownloadDetail};
  }

  @synchronized(self) {
    if (self.koreanModelDownloadProgress != nil
        && ![self.koreanModelDownloadProgress isFinished]
        && ![self.koreanModelDownloadProgress isCancelled]) {
      self.koreanModelDownloadState = @"downloading";
      self.koreanModelDownloadDetail = @"Korean Digital Ink model download is in progress. Wait until it finishes before recognition.";
      return @{@"available": @NO, @"state": @"downloading", @"detail": self.koreanModelDownloadDetail};
    }

    if (self.koreanModelDownloadProgress != nil
        && [self.koreanModelDownloadProgress isFinished]
        && ![modelManager isModelDownloaded:model]) {
      self.koreanModelDownloadState = @"failed";
      self.koreanModelDownloadDetail = @"Korean Digital Ink model download finished but the model is not available. Try model prepare again.";
      self.koreanModelDownloadProgress = nil;
      return @{@"available": @NO, @"state": @"failed", @"detail": self.koreanModelDownloadDetail};
    }

    self.koreanModelDownloadState = @"missing";
    self.koreanModelDownloadDetail = @"Korean Digital Ink model is missing. Run ensureKoreanModel first.";
    return @{@"available": @NO, @"state": @"missing", @"detail": self.koreanModelDownloadDetail};
  }
}

- (MLKDigitalInkRecognizer *)koreanDigitalInkRecognizerWithModel:(MLKDigitalInkRecognitionModel *)model
{
  if (model == nil) {
    return nil;
  }
  @synchronized(self) {
    if (self.koreanRecognizer == nil) {
      MLKDigitalInkRecognizerOptions *recognizerOptions = [[MLKDigitalInkRecognizerOptions alloc] initWithModel:model];
      self.koreanRecognizer = [MLKDigitalInkRecognizer digitalInkRecognizerWithOptions:recognizerOptions];
    }
    return self.koreanRecognizer;
  }
}

- (NSDictionary *)inkFromBsnStrokes:(NSArray *)inkStrokes
{
  NSMutableArray<MLKStroke *> *mlkStrokes = [NSMutableArray array];
  CGFloat minX = CGFLOAT_MAX;
  CGFloat minY = CGFLOAT_MAX;
  CGFloat maxX = -CGFLOAT_MAX;
  CGFloat maxY = -CGFLOAT_MAX;
  NSInteger pageNumber = 1;
  NSInteger syntheticTime = 0;

  for (id rawStroke in inkStrokes) {
    if (![rawStroke isKindOfClass:[NSDictionary class]]) {
      continue;
    }
    NSDictionary *stroke = (NSDictionary *)rawStroke;
    NSString *style = [stroke[@"style"] isKindOfClass:[NSString class]] ? stroke[@"style"] : @"";
    NSString *brush = [stroke[@"brush"] isKindOfClass:[NSString class]] ? stroke[@"brush"] : @"";
    if ([style isEqualToString:@"highlight"] || [brush isEqualToString:@"highlighter"]) {
      continue;
    }
    NSArray *points = [stroke[@"points"] isKindOfClass:[NSArray class]] ? stroke[@"points"] : @[];
    if (points.count == 0) {
      continue;
    }

    NSMutableArray<MLKStrokePoint *> *mlkPoints = [NSMutableArray array];
    NSInteger lastTime = syntheticTime;
    for (id rawPoint in points) {
      if (![rawPoint isKindOfClass:[NSDictionary class]]) {
        continue;
      }
      NSDictionary *point = (NSDictionary *)rawPoint;
      NSNumber *xValue = [point[@"x"] isKindOfClass:[NSNumber class]] ? point[@"x"] : nil;
      NSNumber *yValue = [point[@"y"] isKindOfClass:[NSNumber class]] ? point[@"y"] : nil;
      if (xValue == nil || yValue == nil) {
        continue;
      }
      NSNumber *pageValue = [point[@"pageNumber"] isKindOfClass:[NSNumber class]] ? point[@"pageNumber"] : nil;
      if (pageValue != nil && pageValue.integerValue > 0) {
        pageNumber = pageValue.integerValue;
      }

      CGFloat x = xValue.doubleValue;
      CGFloat y = yValue.doubleValue;
      minX = MIN(minX, x);
      minY = MIN(minY, y);
      maxX = MAX(maxX, x);
      maxY = MAX(maxY, y);

      NSNumber *timeValue = [point[@"t"] isKindOfClass:[NSNumber class]] ? point[@"t"] : nil;
      NSInteger t = timeValue != nil ? timeValue.integerValue : lastTime + 16;
      if (t <= lastTime) {
        t = lastTime + 1;
      }
      lastTime = t;
      [mlkPoints addObject:[[MLKStrokePoint alloc] initWithX:(float)x y:(float)y t:t]];
    }
    syntheticTime = lastTime + 24;
    if (mlkPoints.count > 0) {
      [mlkStrokes addObject:[[MLKStroke alloc] initWithPoints:mlkPoints]];
    }
  }

  NSDictionary *bbox = minX == CGFLOAT_MAX
    ? @{@"x": @0, @"y": @0, @"width": @0, @"height": @0}
    : @{
        @"x": @(minX),
        @"y": @(minY),
        @"width": @(MAX(1.0, maxX - minX)),
        @"height": @(MAX(1.0, maxY - minY)),
      };
  MLKInk *ink = [[MLKInk alloc] initWithStrokes:mlkStrokes];
  return @{@"ink": ink, @"bbox": bbox, @"pageNumber": @(pageNumber), @"strokeCount": @(mlkStrokes.count)};
}

- (NSArray *)candidatesFromRecognitionResult:(MLKDigitalInkRecognitionResult *)result
{
  NSMutableArray *candidates = [NSMutableArray array];
  NSInteger index = 0;
  for (MLKDigitalInkRecognitionCandidate *candidate in result.candidates) {
    NSString *text = candidate.text ?: @"";
    if (text.length == 0) {
      continue;
    }
    double confidence = MAX(0.35, 0.82 - (index * 0.12));
    [candidates addObject:@{@"text": text, @"confidence": @(confidence)}];
    index += 1;
  }
  return candidates;
}
#endif

- (NSDictionary *)unavailableRecognitionWithDetail:(NSString *)detail
{
  return [self unavailableRecognitionWithDetail:detail modelState:nil];
}

- (NSDictionary *)unavailableRecognitionWithDetail:(NSString *)detail modelState:(NSString *)modelState
{
  return @{
    @"status": @"unavailable",
    @"engine": @"mlkit-digital-ink",
    @"text": @"",
    @"keywords": @[],
    @"symbols": @[],
    @"confidence": @0,
    @"clusters": @[],
    @"candidates": @[],
    @"modelState": modelState ?: @"unknown",
    @"detail": detail ?: @"ML Kit Digital Ink is unavailable.",
  };
}

- (NSDictionary *)failedRecognitionWithDetail:(NSString *)detail
{
  return @{
    @"status": @"failed",
    @"engine": @"mlkit-digital-ink",
    @"text": @"",
    @"keywords": @[],
    @"symbols": @[],
    @"confidence": @0,
    @"clusters": @[],
    @"candidates": @[],
    @"modelState": @"unknown",
    @"detail": detail ?: @"ML Kit Digital Ink recognition failed.",
  };
}

@end
