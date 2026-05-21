#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

static NSString * const BsnPencilInteractionEventName = @"BsnPencilInteractionEvent";

@interface PencilInteractionModule : RCTEventEmitter <RCTBridgeModule, UIPencilInteractionDelegate>
@property (nonatomic, strong, nullable) UIPencilInteraction *pencilInteraction;
@property (nonatomic, weak, nullable) UIView *interactionView;
@property (nonatomic, assign) BOOL hasListeners;
@end

@implementation PencilInteractionModule

RCT_EXPORT_MODULE(BsnPencilInteraction)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[BsnPencilInteractionEventName];
}

- (void)startObserving
{
  self.hasListeners = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self installInteractionIfNeeded];
  });
}

- (void)stopObserving
{
  self.hasListeners = NO;
}

RCT_EXPORT_METHOD(start)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self installInteractionIfNeeded];
  });
}

RCT_EXPORT_METHOD(stop)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self uninstallInteraction];
  });
}

RCT_EXPORT_METHOD(getState:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary<NSString *, id> *state = [@{
      @"available": @(YES),
      @"installed": @(self.pencilInteraction != nil),
      @"prefersPencilOnlyDrawing": @([UIPencilInteraction prefersPencilOnlyDrawing]),
      @"preferredTapAction": [self preferredActionName:[UIPencilInteraction preferredTapAction]],
    } mutableCopy];

    if (@available(iOS 17.5, *)) {
      state[@"preferredSqueezeAction"] = [self preferredActionName:[UIPencilInteraction preferredSqueezeAction]];
      state[@"prefersHoverToolPreview"] = @([UIPencilInteraction prefersHoverToolPreview]);
    } else {
      state[@"preferredSqueezeAction"] = @"unavailable";
      state[@"prefersHoverToolPreview"] = @(NO);
    }

    resolve(state);
  });
}

- (void)installInteractionIfNeeded
{
  if (self.pencilInteraction != nil) {
    self.pencilInteraction.enabled = YES;
    return;
  }

  UIView *targetView = [self targetView];
  if (targetView == nil) {
    return;
  }

  UIPencilInteraction *interaction = nil;
  if (@available(iOS 17.5, *)) {
    interaction = [[UIPencilInteraction alloc] initWithDelegate:self];
  } else {
    interaction = [UIPencilInteraction new];
    interaction.delegate = self;
  }

  interaction.enabled = YES;
  [targetView addInteraction:interaction];
  self.pencilInteraction = interaction;
  self.interactionView = targetView;
}

- (void)uninstallInteraction
{
  if (self.pencilInteraction == nil || self.interactionView == nil) {
    self.pencilInteraction = nil;
    self.interactionView = nil;
    return;
  }

  [self.interactionView removeInteraction:self.pencilInteraction];
  self.pencilInteraction = nil;
  self.interactionView = nil;
}

- (UIView *)targetView
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) {
      continue;
    }
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *window in windowScene.windows) {
      if (window.isKeyWindow && window.rootViewController.view != nil) {
        return window.rootViewController.view;
      }
    }
  }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  UIWindow *legacyWindow = UIApplication.sharedApplication.keyWindow;
#pragma clang diagnostic pop
  return legacyWindow.rootViewController.view;
}

- (NSDictionary<NSString *, id> *)eventPayloadWithType:(NSString *)type
                                             timestamp:(NSTimeInterval)timestamp
                                                 phase:(nullable NSString *)phase
                                             hoverPose:(nullable UIPencilHoverPose *)hoverPose
{
  NSMutableDictionary<NSString *, id> *payload = [@{
    @"type": type,
    @"timestamp": @(timestamp),
    @"preferredTapAction": [self preferredActionName:[UIPencilInteraction preferredTapAction]],
  } mutableCopy];

  if (phase != nil) {
    payload[@"phase"] = phase;
  }

  if (@available(iOS 17.5, *)) {
    payload[@"preferredSqueezeAction"] = [self preferredActionName:[UIPencilInteraction preferredSqueezeAction]];
  }

  if (hoverPose != nil) {
    payload[@"hoverPose"] = @{
      @"x": @(hoverPose.location.x),
      @"y": @(hoverPose.location.y),
      @"zOffset": @(hoverPose.zOffset),
      @"azimuthAngle": @(hoverPose.azimuthAngle),
      @"altitudeAngle": @(hoverPose.altitudeAngle),
      @"rollAngle": @(hoverPose.rollAngle),
    };
  }

  return payload;
}

- (void)emitPencilEvent:(NSDictionary<NSString *, id> *)payload
{
  if (!self.hasListeners) {
    return;
  }

  [self sendEventWithName:BsnPencilInteractionEventName body:payload];
}

- (void)pencilInteractionDidTap:(UIPencilInteraction *)interaction
{
  NSDictionary<NSString *, id> *payload = [self eventPayloadWithType:@"tap"
                                                           timestamp:NSProcessInfo.processInfo.systemUptime
                                                               phase:@"ended"
                                                           hoverPose:nil];
  [self emitPencilEvent:payload];
}

- (void)pencilInteraction:(UIPencilInteraction *)interaction didReceiveTap:(UIPencilInteractionTap *)tap
{
  NSDictionary<NSString *, id> *payload = [self eventPayloadWithType:@"tap"
                                                           timestamp:tap.timestamp
                                                               phase:@"ended"
                                                           hoverPose:tap.hoverPose];
  [self emitPencilEvent:payload];
}

- (void)pencilInteraction:(UIPencilInteraction *)interaction didReceiveSqueeze:(UIPencilInteractionSqueeze *)squeeze
{
  NSDictionary<NSString *, id> *payload = [self eventPayloadWithType:@"squeeze"
                                                           timestamp:squeeze.timestamp
                                                               phase:[self phaseName:squeeze.phase]
                                                           hoverPose:squeeze.hoverPose];
  [self emitPencilEvent:payload];
}

- (NSString *)phaseName:(UIPencilInteractionPhase)phase
{
  switch (phase) {
    case UIPencilInteractionPhaseBegan:
      return @"began";
    case UIPencilInteractionPhaseChanged:
      return @"changed";
    case UIPencilInteractionPhaseEnded:
      return @"ended";
    case UIPencilInteractionPhaseCancelled:
      return @"cancelled";
  }
}

- (NSString *)preferredActionName:(UIPencilPreferredAction)action
{
  switch (action) {
    case UIPencilPreferredActionIgnore:
      return @"ignore";
    case UIPencilPreferredActionSwitchEraser:
      return @"switchEraser";
    case UIPencilPreferredActionSwitchPrevious:
      return @"switchPrevious";
    case UIPencilPreferredActionShowColorPalette:
      return @"showColorPalette";
    case UIPencilPreferredActionShowInkAttributes:
      return @"showInkAttributes";
    case UIPencilPreferredActionShowContextualPalette:
      return @"showContextualPalette";
    case UIPencilPreferredActionRunSystemShortcut:
      return @"runSystemShortcut";
  }
}

@end
