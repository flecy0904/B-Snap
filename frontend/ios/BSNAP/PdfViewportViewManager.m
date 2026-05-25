#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <PDFKit/PDFKit.h>
#import <React/RCTComponent.h>
#import <React/RCTConvert.h>
#import <React/RCTViewManager.h>

static CGFloat const BsnPdfPageGap = 10.0;
static CGFloat const BsnPdfMinZoom = 1.0;
static CGFloat const BsnPdfMaxZoom = 4.0;
static CGFloat const BsnPdfHiResMinZoom = 1.35;
static CGFloat const BsnPdfHiResOverscan = 0.3;

@interface BsnPdfPageLayout : NSObject
@property (nonatomic, copy) NSString *pageId;
@property (nonatomic, copy) NSString *kind;
@property (nonatomic, copy) NSString *label;
@property (nonatomic, strong, nullable) NSNumber *pageNumber;
@property (nonatomic, copy, nullable) NSString *generatedPageId;
@property (nonatomic) CGRect frame;
@property (nonatomic) CGSize logicalSize;
@end

@implementation BsnPdfPageLayout
@end

@interface BsnPdfHiResRequest : NSObject
@property (nonatomic) NSInteger generation;
@property (nonatomic) NSInteger pageNumber;
@property (nonatomic) NSInteger targetWidth;
@property (nonatomic) CGFloat regionX;
@property (nonatomic) CGFloat regionY;
@property (nonatomic) CGFloat regionWidth;
@property (nonatomic) CGFloat regionHeight;
@end

@implementation BsnPdfHiResRequest
@end

@interface BsnPdfHiResOverlay : NSObject
@property (nonatomic, strong) BsnPdfHiResRequest *request;
@property (nonatomic, strong) UIImage *image;
@end

@implementation BsnPdfHiResOverlay
@end

@class BsnPdfViewportView;

@interface BsnPdfContentView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfInkInputView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfViewportView : UIView <UIScrollViewDelegate, UIGestureRecognizerDelegate>
@property (nonatomic, copy, nullable) NSString *fileUri;
@property (nonatomic) NSInteger requestedPage;
@property (nonatomic, copy) NSArray<NSDictionary *> *notebookPages;
@property (nonatomic, copy) NSString *inkTool;
@property (nonatomic) BOOL fingerDrawingEnabled;
@property (nonatomic, copy) NSString *penColor;
@property (nonatomic) CGFloat penWidth;
@property (nonatomic, copy) NSString *brushType;
@property (nonatomic, copy) NSString *linePattern;
@property (nonatomic, copy, nullable) NSDictionary *brushSettings;
@property (nonatomic, copy) NSArray<NSDictionary *> *inkStrokes;
@property (nonatomic, strong) UIScrollView *scrollView;
@property (nonatomic, strong, nullable) PDFDocument *document;
@property (nonatomic, copy) NSArray<BsnPdfPageLayout *> *layouts;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onDocumentLoaded;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onPageChanged;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onViewportChanged;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onCommitInkStroke;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onRemoveInkStroke;
- (void)drawInkForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (nullable UIImage *)baseImageForPageNumber:(NSInteger)pageNumber;
- (void)requestBaseRenderForLayout:(BsnPdfPageLayout *)layout priority:(NSInteger)priority;
- (void)drawHiResOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (NSString *)emptyStateMessage;
- (nullable NSDictionary *)hitPagePointAtViewPoint:(CGPoint)viewPoint;
- (BOOL)shouldAcceptTouch:(UITouch *)touch;
- (void)beginInkAtPoint:(CGPoint)viewPoint;
- (void)moveInkAtPoint:(CGPoint)viewPoint;
- (void)endInkWithCommit:(BOOL)commit;
- (void)redrawContent;
@end

@interface BsnPdfViewportView ()
@property (nonatomic, strong) BsnPdfContentView *contentView;
@property (nonatomic, strong) BsnPdfInkInputView *inkInputView;
@property (nonatomic, strong) UIPanGestureRecognizer *pencilInkPanGesture;
@property (nonatomic, strong) UIPanGestureRecognizer *fingerInkPanGesture;
@property (nonatomic, strong) NSOperationQueue *baseRenderQueue;
@property (nonatomic, strong) NSOperationQueue *hiResRenderQueue;
@property (nonatomic, strong) NSCache<NSString *, UIImage *> *baseBitmapCache;
@property (nonatomic, strong) NSMutableSet<NSString *> *baseRenderRequests;
@property (nonatomic, strong) NSMutableSet<NSString *> *wantedBaseRenderKeys;
@property (nonatomic, strong) NSMutableSet<NSString *> *startedBaseRenderKeys;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, BsnPdfHiResOverlay *> *hiResOverlays;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, BsnPdfHiResRequest *> *hiResInFlight;
@property (nonatomic, strong, nullable) NSMutableDictionary *activeStroke;
@property (nonatomic, strong, nullable) NSMutableDictionary *lastViewportPayload;
@property (nonatomic, copy, nullable) NSString *loadErrorMessage;
@property (nonatomic) NSInteger lastPageNumber;
@property (nonatomic) NSInteger reportedPageNumber;
@property (nonatomic) BOOL pendingScrollToRequestedPage;
@property (nonatomic) BOOL hasAppliedInitialPage;
@property (nonatomic) BOOL viewportEventScheduled;
@property (nonatomic) NSInteger renderGeneration;
@property (nonatomic) NSInteger hiResGeneration;
@property (nonatomic) NSInteger baseRenderDirection;
@property (nonatomic) CGFloat lastContentOffsetY;
@property (nonatomic, copy) NSString *lastBaseRenderScheduleKey;
@property (nonatomic, copy) NSString *lastViewportEventKey;
- (nullable NSDictionary *)captureViewportAnchor;
- (void)restoreViewportAnchor:(NSDictionary *)anchor;
- (void)scheduleBaseRendersForce:(BOOL)force;
- (void)requestHiResOverlayAfterDelay:(NSTimeInterval)delayMs;
- (void)requestViewportChangedForce:(BOOL)force;
- (void)emitViewportChangedThrottled;
- (void)emitViewportChangedForce:(BOOL)force;
- (void)emitPageChangedDebounced;
- (void)handleInkPan:(UIPanGestureRecognizer *)gesture;
@end

@implementation BsnPdfContentView

- (void)drawRect:(CGRect)rect
{
  BsnPdfViewportView *owner = self.owner;
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (owner == nil || context == nil) return;

  [[UIColor colorWithRed:0.95 green:0.96 blue:0.98 alpha:1.0] setFill];
  CGContextFillRect(context, rect);

  if (owner.layouts.count == 0) {
    NSDictionary *attrs = @{
      NSFontAttributeName: [UIFont systemFontOfSize:14 weight:UIFontWeightSemibold],
      NSForegroundColorAttributeName: [UIColor colorWithRed:0.50 green:0.55 blue:0.65 alpha:1.0],
    };
    NSString *message = [owner emptyStateMessage];
    CGSize size = [message sizeWithAttributes:attrs];
    [message drawAtPoint:CGPointMake((self.bounds.size.width - size.width) * 0.5, (self.bounds.size.height - size.height) * 0.5) withAttributes:attrs];
    return;
  }

  for (BsnPdfPageLayout *layout in owner.layouts) {
    if (!CGRectIntersectsRect(rect, layout.frame)) continue;
    [[UIColor whiteColor] setFill];
    CGContextFillRect(context, layout.frame);

    if ([layout.kind isEqualToString:@"pdf"] && layout.pageNumber != nil && owner.document != nil) {
      UIImage *baseImage = [owner baseImageForPageNumber:layout.pageNumber.integerValue];
      if (baseImage != nil) {
        [baseImage drawInRect:layout.frame];
      } else {
        [[UIColor colorWithRed:0.97 green:0.98 blue:1.0 alpha:1.0] setFill];
        CGContextFillRect(context, layout.frame);
        NSDictionary *attrs = @{
          NSFontAttributeName: [UIFont systemFontOfSize:13 weight:UIFontWeightSemibold],
          NSForegroundColorAttributeName: [UIColor colorWithRed:0.50 green:0.55 blue:0.65 alpha:1.0],
        };
        [layout.label drawAtPoint:CGPointMake(CGRectGetMidX(layout.frame) - 22, CGRectGetMidY(layout.frame) - 8) withAttributes:attrs];
        [owner requestBaseRenderForLayout:layout priority:0];
      }
      [owner drawHiResOverlayForLayout:layout inContext:context];
    } else {
      [[UIColor colorWithRed:1.0 green:0.99 blue:0.97 alpha:1.0] setFill];
      CGContextFillRect(context, layout.frame);
      NSDictionary *attrs = @{
        NSFontAttributeName: [UIFont systemFontOfSize:13 weight:UIFontWeightSemibold],
        NSForegroundColorAttributeName: [UIColor colorWithRed:0.72 green:0.44 blue:0.12 alpha:1.0],
      };
      [layout.label drawAtPoint:CGPointMake(layout.frame.origin.x + 32, layout.frame.origin.y + 32) withAttributes:attrs];
    }

    [owner drawInkForLayout:layout inContext:context];
    [[UIColor colorWithRed:0.88 green:0.9 blue:0.94 alpha:1.0] setStroke];
    CGContextStrokeRectWithWidth(context, layout.frame, 1.0 / MAX(1.0, owner.scrollView.zoomScale));
  }
}

@end

@implementation BsnPdfInkInputView

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  UITouch *touch = touches.anyObject;
  if (touch == nil) return;
  if (![self.owner shouldAcceptTouch:touch]) return;
  [self.owner beginInkAtPoint:[touch locationInView:self]];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  UITouch *touch = touches.anyObject;
  if (touch == nil) return;
  if (![self.owner shouldAcceptTouch:touch]) return;
  [self.owner moveInkAtPoint:[touch locationInView:self]];
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [self.owner endInkWithCommit:YES];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [self.owner endInkWithCommit:NO];
}

@end

@implementation BsnPdfViewportView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _requestedPage = 1;
    _inkTool = @"view";
    _penColor = @"#111827";
    _penWidth = 3.0;
    _brushType = @"pen";
    _linePattern = @"solid";
    _notebookPages = @[];
    _inkStrokes = @[];
    _layouts = @[];
    _pendingScrollToRequestedPage = YES;
    _hasAppliedInitialPage = NO;
    _viewportEventScheduled = NO;
    _lastPageNumber = 0;
    _reportedPageNumber = 0;
    _renderGeneration = 0;
    _hiResGeneration = 0;
    _baseRenderDirection = 0;
    _lastBaseRenderScheduleKey = @"";
    _lastViewportEventKey = @"";

    _scrollView = [[UIScrollView alloc] initWithFrame:self.bounds];
    _scrollView.delegate = self;
    _scrollView.minimumZoomScale = BsnPdfMinZoom;
    _scrollView.maximumZoomScale = BsnPdfMaxZoom;
    _scrollView.bouncesZoom = YES;
    _scrollView.alwaysBounceVertical = YES;
    _scrollView.showsHorizontalScrollIndicator = NO;
    _scrollView.showsVerticalScrollIndicator = YES;
    _scrollView.backgroundColor = [UIColor colorWithRed:0.95 green:0.96 blue:0.98 alpha:1.0];
    [self addSubview:_scrollView];

    _contentView = [[BsnPdfContentView alloc] initWithFrame:CGRectZero];
    _contentView.owner = self;
    _contentView.backgroundColor = _scrollView.backgroundColor;
    [_scrollView addSubview:_contentView];

    _inkInputView = [[BsnPdfInkInputView alloc] initWithFrame:self.bounds];
    _inkInputView.owner = self;
    _inkInputView.backgroundColor = UIColor.clearColor;
    [self addSubview:_inkInputView];

    _pencilInkPanGesture = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handlePencilInkPan:)];
    _pencilInkPanGesture.minimumNumberOfTouches = 1;
    _pencilInkPanGesture.maximumNumberOfTouches = 1;
    _pencilInkPanGesture.cancelsTouchesInView = YES;
    _pencilInkPanGesture.delegate = self;
    if (@available(iOS 9.1, *)) {
      _pencilInkPanGesture.allowedTouchTypes = @[@(UITouchTypePencil)];
    }
    [self addGestureRecognizer:_pencilInkPanGesture];

    _fingerInkPanGesture = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handleFingerInkPan:)];
    _fingerInkPanGesture.minimumNumberOfTouches = 1;
    _fingerInkPanGesture.maximumNumberOfTouches = 1;
    _fingerInkPanGesture.cancelsTouchesInView = YES;
    _fingerInkPanGesture.delegate = self;
    if (@available(iOS 9.1, *)) {
      _fingerInkPanGesture.allowedTouchTypes = @[@(UITouchTypeDirect)];
    }
    [self addGestureRecognizer:_fingerInkPanGesture];
    [_scrollView.panGestureRecognizer requireGestureRecognizerToFail:_fingerInkPanGesture];

    _baseBitmapCache = [NSCache new];
    _baseBitmapCache.totalCostLimit = 96 * 1024 * 1024;
    _baseRenderRequests = [NSMutableSet set];
    _wantedBaseRenderKeys = [NSMutableSet set];
    _startedBaseRenderKeys = [NSMutableSet set];
    _baseRenderQueue = [NSOperationQueue new];
    _baseRenderQueue.name = @"BsnPdfViewportBaseRenderQueue";
    _baseRenderQueue.maxConcurrentOperationCount = 2;
    _baseRenderQueue.qualityOfService = NSQualityOfServiceUserInitiated;

    _hiResOverlays = [NSMutableDictionary dictionary];
    _hiResInFlight = [NSMutableDictionary dictionary];
    _hiResRenderQueue = [NSOperationQueue new];
    _hiResRenderQueue.name = @"BsnPdfViewportHiResRenderQueue";
    _hiResRenderQueue.maxConcurrentOperationCount = 1;
    _hiResRenderQueue.qualityOfService = NSQualityOfServiceUserInitiated;
    [self updateInkInputEnabled];
  }
  return self;
}

- (void)dealloc
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
  [self.baseRenderQueue cancelAllOperations];
  [self.hiResRenderQueue cancelAllOperations];
  [self.baseBitmapCache removeAllObjects];
  [self.hiResOverlays removeAllObjects];
  [self.hiResInFlight removeAllObjects];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  self.scrollView.frame = self.bounds;
  self.inkInputView.frame = self.bounds;
  [self rebuildLayout];
}

- (void)setFileUri:(NSString *)fileUri
{
  if ((_fileUri == fileUri) || [_fileUri isEqualToString:fileUri]) return;
  _fileUri = [fileUri copy];
  [self openDocument];
}

- (void)setRequestedPage:(NSInteger)requestedPage
{
  NSInteger nextPage = MAX(1, requestedPage);
  _requestedPage = nextPage;
  if (nextPage == self.lastPageNumber) return;
  if (!self.hasAppliedInitialPage && self.layouts.count > 0) {
    _pendingScrollToRequestedPage = YES;
    [self scrollToRequestedPageIfNeeded];
  } else if (!self.scrollView.isTracking && !self.scrollView.isDragging && !self.scrollView.isDecelerating && self.lastPageNumber == 0 && self.layouts.count > 0) {
    _pendingScrollToRequestedPage = YES;
    [self scrollToRequestedPageIfNeeded];
  }
}

- (void)setNotebookPages:(NSArray<NSDictionary *> *)notebookPages
{
  _notebookPages = [notebookPages isKindOfClass:NSArray.class] ? [notebookPages copy] : @[];
  [self rebuildLayout];
}

- (void)setInkTool:(NSString *)inkTool
{
  _inkTool = inkTool.length ? [inkTool copy] : @"view";
  [self updateInkInputEnabled];
}

- (void)setFingerDrawingEnabled:(BOOL)fingerDrawingEnabled
{
  _fingerDrawingEnabled = fingerDrawingEnabled;
  [self updateInkInputEnabled];
}

- (void)setPenColor:(NSString *)penColor { _penColor = penColor.length ? [penColor copy] : @"#111827"; }
- (void)setPenWidth:(CGFloat)penWidth { _penWidth = MAX(1.0, penWidth); }
- (void)setBrushType:(NSString *)brushType { _brushType = brushType.length ? [brushType copy] : @"pen"; }
- (void)setLinePattern:(NSString *)linePattern { _linePattern = linePattern.length ? [linePattern copy] : @"solid"; }

- (void)setInkStrokes:(NSArray<NSDictionary *> *)inkStrokes
{
  _inkStrokes = [inkStrokes isKindOfClass:NSArray.class] ? [inkStrokes copy] : @[];
  [self redrawContent];
}

- (void)openDocument
{
  self.document = nil;
  self.layouts = @[];
  self.activeStroke = nil;
  self.loadErrorMessage = nil;
  self.lastPageNumber = 0;
  self.reportedPageNumber = 0;
  self.pendingScrollToRequestedPage = YES;
  self.hasAppliedInitialPage = NO;
  self.viewportEventScheduled = NO;
  self.renderGeneration += 1;
  self.hiResGeneration += 1;
  self.baseRenderDirection = 0;
  self.lastBaseRenderScheduleKey = @"";
  self.lastViewportEventKey = @"";
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitViewportChangedThrottled) object:nil];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitPageChangedDebounced) object:nil];
  [self.baseRenderQueue cancelAllOperations];
  [self.hiResRenderQueue cancelAllOperations];
  [self.baseBitmapCache removeAllObjects];
  [self.baseRenderRequests removeAllObjects];
  [self.wantedBaseRenderKeys removeAllObjects];
  [self.startedBaseRenderKeys removeAllObjects];
  [self.hiResOverlays removeAllObjects];
  [self.hiResInFlight removeAllObjects];

  NSURL *url = [self fileURLFromString:self.fileUri];
  if (url == nil) {
    self.loadErrorMessage = self.fileUri.length == 0 ? @"PDF source is empty." : @"Only local PDF files are supported.";
  } else if (![[NSFileManager defaultManager] fileExistsAtPath:url.path]) {
    self.loadErrorMessage = @"PDF file does not exist.";
  } else {
    self.document = [[PDFDocument alloc] initWithURL:url];
    if (self.document == nil || self.document.pageCount <= 0) {
      self.loadErrorMessage = @"PDF open failed.";
      self.document = nil;
    }
  }
  [self rebuildLayout];
  if (self.document != nil && self.onDocumentLoaded != nil) {
    self.onDocumentLoaded(@{@"pageCount": @(self.document.pageCount)});
  }
}

- (NSURL *)fileURLFromString:(NSString *)fileUri
{
  if (fileUri.length == 0) return nil;
  NSURL *url = [NSURL URLWithString:fileUri];
  if (url != nil && url.isFileURL) return url;
  if (url != nil && url.scheme.length > 0) return nil;
  return [NSURL fileURLWithPath:[fileUri stringByRemovingPercentEncoding] ?: fileUri];
}

- (NSString *)emptyStateMessage
{
  if (self.loadErrorMessage.length > 0) return self.loadErrorMessage;
  if (self.fileUri.length == 0) return @"PDF source is empty.";
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0) return @"PDF view has no size.";
  if (self.document == nil) return @"PDF loading...";
  return @"PDF layout is empty.";
}

- (NSArray<BsnPdfPageLayout *> *)buildNotebookLayouts
{
  NSMutableArray<BsnPdfPageLayout *> *result = [NSMutableArray array];
  NSInteger pageCount = self.document.pageCount;
  NSArray<NSDictionary *> *sourcePages = self.notebookPages.count ? self.notebookPages : @[];
  if (sourcePages.count == 0) {
    NSMutableArray *generated = [NSMutableArray array];
    for (NSInteger page = 1; page <= pageCount; page += 1) {
      [generated addObject:@{@"kind": @"pdf", @"pageNumber": @(page), @"id": [NSString stringWithFormat:@"%ld", (long)page], @"label": [NSString stringWithFormat:@"%ld", (long)page]}];
    }
    sourcePages = generated;
  }

  CGFloat contentWidth = MAX(1.0, self.bounds.size.width);
  CGFloat y = 0;
  for (NSDictionary *pageInfo in sourcePages) {
    NSString *kind = [RCTConvert NSString:pageInfo[@"kind"]] ?: @"pdf";
    NSNumber *pageNumber = pageInfo[@"pageNumber"] != nil ? [RCTConvert NSNumber:pageInfo[@"pageNumber"]] : nil;
    if ([kind isEqualToString:@"pdf"] && (pageNumber == nil || pageNumber.integerValue < 1 || pageNumber.integerValue > pageCount)) continue;

    CGSize logicalSize = CGSizeMake(612, 792);
    if ([kind isEqualToString:@"pdf"] && pageNumber != nil) {
      PDFPage *pdfPage = [self.document pageAtIndex:pageNumber.integerValue - 1];
      CGRect bounds = [pdfPage boundsForBox:kPDFDisplayBoxCropBox];
      if (CGRectIsEmpty(bounds) || bounds.size.width <= 0 || bounds.size.height <= 0) bounds = [pdfPage boundsForBox:kPDFDisplayBoxMediaBox];
      if (!CGRectIsEmpty(bounds) && bounds.size.width > 0 && bounds.size.height > 0) logicalSize = bounds.size;
    }
    CGFloat pageHeight = contentWidth * logicalSize.height / MAX(1.0, logicalSize.width);

    BsnPdfPageLayout *layout = [BsnPdfPageLayout new];
    layout.kind = kind;
    layout.pageNumber = pageNumber;
    layout.generatedPageId = pageInfo[@"generatedPageId"] != nil ? [RCTConvert NSString:pageInfo[@"generatedPageId"]] : nil;
    layout.pageId = layout.generatedPageId ?: (pageNumber != nil ? [NSString stringWithFormat:@"pdf:%@", pageNumber] : ([RCTConvert NSString:pageInfo[@"id"]] ?: [NSUUID UUID].UUIDString));
    layout.label = [RCTConvert NSString:pageInfo[@"label"]] ?: (pageNumber != nil ? [NSString stringWithFormat:@"%@p", pageNumber] : @"Page");
    layout.logicalSize = logicalSize;
    layout.frame = CGRectMake(0, y, contentWidth, pageHeight);
    [result addObject:layout];
    y += pageHeight + BsnPdfPageGap;
  }
  return result;
}

- (nullable NSDictionary *)captureViewportAnchor
{
  if (self.layouts.count == 0 || self.bounds.size.height <= 0) return nil;
  CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
  CGFloat centerY = (self.scrollView.contentOffset.y + self.bounds.size.height * 0.5) / zoom;
  BsnPdfPageLayout *best = nil;
  CGFloat bestDistance = CGFLOAT_MAX;
  for (BsnPdfPageLayout *layout in self.layouts) {
    CGFloat distance = CGRectContainsPoint(layout.frame, CGPointMake(CGRectGetMidX(layout.frame), centerY))
      ? 0
      : fabs(CGRectGetMidY(layout.frame) - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = layout;
    }
  }
  if (best == nil) return nil;
  CGFloat progress = (centerY - CGRectGetMinY(best.frame)) / MAX(1.0, best.frame.size.height);
  progress = MIN(1.0, MAX(0, progress));
  NSMutableDictionary *anchor = [@{
    @"pageId": best.pageId ?: @"",
    @"pageProgressY": @(progress),
  } mutableCopy];
  if (best.pageNumber != nil) anchor[@"pageNumber"] = best.pageNumber;
  if (best.generatedPageId != nil) anchor[@"generatedPageId"] = best.generatedPageId;
  return anchor;
}

- (void)restoreViewportAnchor:(NSDictionary *)anchor
{
  if (anchor == nil || self.layouts.count == 0 || self.bounds.size.height <= 0) return;
  NSString *pageId = [RCTConvert NSString:anchor[@"pageId"]];
  NSString *generatedPageId = [RCTConvert NSString:anchor[@"generatedPageId"]];
  NSNumber *pageNumber = anchor[@"pageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"pageNumber"]] : nil;
  BsnPdfPageLayout *target = nil;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if ((pageId.length > 0 && [layout.pageId isEqualToString:pageId])
      || (generatedPageId.length > 0 && [layout.generatedPageId isEqualToString:generatedPageId])
      || (pageNumber != nil && layout.pageNumber != nil && layout.pageNumber.integerValue == pageNumber.integerValue)) {
      target = layout;
      break;
    }
  }
  if (target == nil) return;
  CGFloat progress = MIN(1.0, MAX(0, [anchor[@"pageProgressY"] doubleValue]));
  CGFloat zoom = MAX(BsnPdfMinZoom, self.scrollView.zoomScale);
  CGFloat centerY = CGRectGetMinY(target.frame) + target.frame.size.height * progress;
  CGFloat nextY = centerY * zoom - self.bounds.size.height * 0.5;
  CGFloat maxY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
  self.scrollView.contentOffset = CGPointMake(self.scrollView.contentOffset.x, MIN(MAX(0, nextY), maxY));
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
}

- (void)rebuildLayout
{
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0 || self.document == nil) {
    self.contentView.frame = CGRectMake(0, 0, MAX(1.0, self.bounds.size.width), MAX(1.0, self.bounds.size.height));
    self.scrollView.contentSize = self.contentView.frame.size;
    [self.contentView setNeedsDisplay];
    [self requestViewportChangedForce:YES];
    return;
  }

  NSDictionary *anchor = self.pendingScrollToRequestedPage ? nil : [self captureViewportAnchor];
  CGFloat previousZoom = MAX(BsnPdfMinZoom, self.scrollView.zoomScale);
  self.layouts = [self buildNotebookLayouts];
  BsnPdfPageLayout *last = self.layouts.lastObject;
  CGFloat contentHeight = last != nil ? CGRectGetMaxY(last.frame) : self.bounds.size.height;
  self.contentView.frame = CGRectMake(0, 0, MAX(1.0, self.bounds.size.width), MAX(1.0, contentHeight));
  self.scrollView.contentSize = self.contentView.frame.size;
  self.scrollView.minimumZoomScale = BsnPdfMinZoom;
  self.scrollView.maximumZoomScale = BsnPdfMaxZoom;
  self.scrollView.zoomScale = MIN(BsnPdfMaxZoom, MAX(BsnPdfMinZoom, previousZoom));
  if (anchor != nil) [self restoreViewportAnchor:anchor];
  CGFloat maxOffsetX = MAX(0, self.scrollView.contentSize.width - self.bounds.size.width);
  CGFloat maxOffsetY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
  self.scrollView.contentOffset = CGPointMake(
    MIN(MAX(0, self.scrollView.contentOffset.x), maxOffsetX),
    MIN(MAX(0, self.scrollView.contentOffset.y), maxOffsetY)
  );
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
  [self.contentView setNeedsDisplay];
  [self scrollToRequestedPageIfNeeded];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
  [self requestViewportChangedForce:YES];
}

- (UIView *)viewForZoomingInScrollView:(UIScrollView *)scrollView
{
  return self.contentView;
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  CGFloat deltaY = scrollView.contentOffset.y - self.lastContentOffsetY;
  self.lastContentOffsetY = scrollView.contentOffset.y;
  [self updateBaseRenderDirection:deltaY];
  [self scheduleBaseRendersForce:NO];
  [self requestHiResOverlayAfterDelay:120];
  [self emitPageChangedIfNeeded];
  [self requestViewportChangedForce:NO];
}

- (void)scrollViewDidZoom:(UIScrollView *)scrollView
{
  [self scheduleBaseRendersForce:NO];
  [self requestHiResOverlayAfterDelay:120];
  [self emitPageChangedIfNeeded];
  [self requestViewportChangedForce:NO];
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate
{
  if (!decelerate) {
    [self resetBaseRenderDirection];
    [self scheduleBaseRendersForce:YES];
    [self requestHiResOverlayAfterDelay:0];
  }
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView
{
  [self resetBaseRenderDirection];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
}

- (void)scrollViewDidEndZooming:(UIScrollView *)scrollView withView:(UIView *)view atScale:(CGFloat)scale
{
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
}

- (NSInteger)baseRenderTargetWidth
{
  CGFloat screenScale = UIScreen.mainScreen.scale;
  return MAX(1, MIN(1200, (NSInteger)llround(self.bounds.size.width * screenScale)));
}

- (NSString *)baseCacheKeyForPageNumber:(NSInteger)pageNumber targetWidth:(NSInteger)targetWidth
{
  return [NSString stringWithFormat:@"%@:%ld:%ld", self.fileUri ?: @"", (long)pageNumber, (long)targetWidth];
}

- (nullable UIImage *)baseImageForPageNumber:(NSInteger)pageNumber
{
  return [self.baseBitmapCache objectForKey:[self baseCacheKeyForPageNumber:pageNumber targetWidth:[self baseRenderTargetWidth]]];
}

- (void)scheduleBaseRendersForce:(BOOL)force
{
  if (self.document == nil || self.layouts.count == 0 || self.bounds.size.width <= 0) return;
  NSInteger centerIndex = [self centerLayoutIndex];
  if (centerIndex < 0) return;
  NSArray<NSNumber *> *indexes = [self baseRenderPriorityIndexesFromCenter:centerIndex];
  NSInteger targetWidth = [self baseRenderTargetWidth];
  NSMutableSet<NSString *> *wantedKeys = [NSMutableSet set];
  NSMutableArray<NSString *> *scheduleParts = [NSMutableArray array];
  for (NSNumber *indexNumber in indexes) {
    BsnPdfPageLayout *layout = self.layouts[indexNumber.integerValue];
    if (layout.pageNumber == nil) continue;
    NSString *key = [self baseCacheKeyForPageNumber:layout.pageNumber.integerValue targetWidth:targetWidth];
    [wantedKeys addObject:key];
    [scheduleParts addObject:[NSString stringWithFormat:@"%ld", (long)indexNumber.integerValue]];
  }
  NSString *scheduleKey = [NSString stringWithFormat:@"%ld:%ld:%ld:%@", (long)self.renderGeneration, (long)targetWidth, (long)self.baseRenderDirection, [scheduleParts componentsJoinedByString:@","]];
  if (!force && [scheduleKey isEqualToString:self.lastBaseRenderScheduleKey]) return;
  self.lastBaseRenderScheduleKey = scheduleKey;
  @synchronized (self) {
    self.wantedBaseRenderKeys = wantedKeys;
    [self.baseRenderRequests intersectSet:wantedKeys];
  }
  [self.baseRenderQueue cancelAllOperations];
  [indexes enumerateObjectsUsingBlock:^(NSNumber *indexNumber, NSUInteger priority, BOOL *stop) {
    BsnPdfPageLayout *layout = self.layouts[indexNumber.integerValue];
    [self requestBaseRenderForLayout:layout priority:(NSInteger)priority];
  }];
}

- (NSInteger)centerLayoutIndex
{
  CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
  CGFloat centerY = (self.scrollView.contentOffset.y + self.bounds.size.height * 0.5) / zoom;
  NSInteger bestIndex = -1;
  CGFloat bestDistance = CGFLOAT_MAX;
  for (NSInteger index = 0; index < self.layouts.count; index += 1) {
    BsnPdfPageLayout *layout = self.layouts[index];
    CGFloat distance = fabs(CGRectGetMidY(layout.frame) - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

- (NSArray<NSNumber *> *)baseRenderPriorityIndexesFromCenter:(NSInteger)centerIndex
{
  NSMutableArray<NSNumber *> *indexes = [NSMutableArray array];
  void (^addIndex)(NSInteger) = ^(NSInteger index) {
    if (index < 0 || index >= self.layouts.count) return;
    NSNumber *value = @(index);
    if (![indexes containsObject:value]) [indexes addObject:value];
  };
  addIndex(centerIndex);
  if (self.baseRenderDirection > 0) {
    for (NSInteger offset = 1; offset <= 5; offset += 1) addIndex(centerIndex + offset);
  } else if (self.baseRenderDirection < 0) {
    for (NSInteger offset = -1; offset >= -5; offset -= 1) addIndex(centerIndex + offset);
  } else {
    NSArray<NSNumber *> *offsets = @[@(-1), @(1), @(-2), @(2), @(3)];
    for (NSNumber *offset in offsets) addIndex(centerIndex + offset.integerValue);
  }
  return indexes;
}

- (void)requestBaseRenderForLayout:(BsnPdfPageLayout *)layout priority:(NSInteger)priority
{
  if (self.document == nil || layout.pageNumber == nil || self.bounds.size.width <= 0) return;
  NSInteger pageNumber = layout.pageNumber.integerValue;
  NSInteger targetWidth = [self baseRenderTargetWidth];
  NSString *key = [self baseCacheKeyForPageNumber:pageNumber targetWidth:targetWidth];
  if ([self.baseBitmapCache objectForKey:key] != nil) return;
  NSURL *fileURL = [self fileURLFromString:self.fileUri];
  if (fileURL == nil) return;
  @synchronized (self) {
    if (self.wantedBaseRenderKeys.count > 0 && ![self.wantedBaseRenderKeys containsObject:key]) return;
    if ([self.baseRenderRequests containsObject:key]) return;
    if ([self.startedBaseRenderKeys containsObject:key]) return;
    [self.baseRenderRequests addObject:key];
  }
  NSInteger generation = self.renderGeneration;

  __weak typeof(self) weakSelf = self;
  NSBlockOperation *operation = [NSBlockOperation blockOperationWithBlock:^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (strongSelf == nil) return;
    @synchronized (strongSelf) {
      [strongSelf.baseRenderRequests removeObject:key];
      if (![strongSelf.wantedBaseRenderKeys containsObject:key]) return;
      if ([strongSelf.startedBaseRenderKeys containsObject:key]) return;
      [strongSelf.startedBaseRenderKeys addObject:key];
    }
    UIImage *image = [strongSelf renderBasePageNumber:pageNumber targetWidth:targetWidth fileURL:fileURL];
    [[NSOperationQueue mainQueue] addOperationWithBlock:^{
      __strong typeof(weakSelf) currentSelf = weakSelf;
      if (currentSelf == nil) return;
      @synchronized (currentSelf) {
        [currentSelf.baseRenderRequests removeObject:key];
        [currentSelf.startedBaseRenderKeys removeObject:key];
      }
      if (generation != currentSelf.renderGeneration || image == nil) {
        if (generation == currentSelf.renderGeneration) [currentSelf scheduleBaseRendersForce:YES];
        return;
      }
      @synchronized (currentSelf) {
        if (currentSelf.wantedBaseRenderKeys.count > 0 && ![currentSelf.wantedBaseRenderKeys containsObject:key]) return;
      }
      NSInteger cost = MAX(1, (NSInteger)llround(image.size.width * image.scale * image.size.height * image.scale * 4));
      [currentSelf.baseBitmapCache setObject:image forKey:key cost:cost];
      [currentSelf.contentView setNeedsDisplay];
    }];
  }];
  operation.queuePriority = priority == 0 ? NSOperationQueuePriorityVeryHigh : NSOperationQueuePriorityNormal;
  [self.baseRenderQueue addOperation:operation];
}

- (nullable UIImage *)renderBasePageNumber:(NSInteger)pageNumber targetWidth:(NSInteger)targetWidth fileURL:(NSURL *)fileURL
{
  PDFDocument *document = [[PDFDocument alloc] initWithURL:fileURL];
  if (document == nil || pageNumber < 1 || pageNumber > document.pageCount) return nil;
  PDFPage *page = [document pageAtIndex:pageNumber - 1];
  if (page == nil) return nil;
  PDFDisplayBox box = kPDFDisplayBoxCropBox;
  CGRect pageBounds = [page boundsForBox:box];
  if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) {
    box = kPDFDisplayBoxMediaBox;
    pageBounds = [page boundsForBox:box];
  }
  if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) return nil;
  NSInteger targetHeight = MAX(1, (NSInteger)llround((CGFloat)targetWidth * pageBounds.size.height / pageBounds.size.width));
  CGSize imageSize = CGSizeMake((CGFloat)targetWidth, (CGFloat)targetHeight);
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.opaque = YES;
  format.scale = 1.0;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:imageSize format:format];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull rendererContext) {
    CGContextRef context = rendererContext.CGContext;
    [[UIColor whiteColor] setFill];
    CGContextFillRect(context, CGRectMake(0, 0, imageSize.width, imageSize.height));
    CGContextSaveGState(context);
    CGContextTranslateCTM(context, 0, imageSize.height);
    CGContextScaleCTM(context, 1.0, -1.0);
    CGContextScaleCTM(context, imageSize.width / pageBounds.size.width, imageSize.height / pageBounds.size.height);
    CGContextTranslateCTM(context, -pageBounds.origin.x, -pageBounds.origin.y);
    [page drawWithBox:box toContext:context];
    CGContextRestoreGState(context);
  }];
}

- (void)updateBaseRenderDirection:(CGFloat)deltaY
{
  if (fabs(deltaY) < 0.5) return;
  NSInteger nextDirection = deltaY > 0 ? 1 : -1;
  if (self.baseRenderDirection == nextDirection) return;
  self.baseRenderDirection = nextDirection;
  self.lastBaseRenderScheduleKey = @"";
}

- (void)resetBaseRenderDirection
{
  if (self.baseRenderDirection == 0) return;
  self.baseRenderDirection = 0;
  self.lastBaseRenderScheduleKey = @"";
}

- (void)requestHiResOverlayAfterDelay:(NSTimeInterval)delayMs
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(startHiResOverlayRender) object:nil];
  if (delayMs <= 0) {
    [self startHiResOverlayRender];
  } else {
    [self performSelector:@selector(startHiResOverlayRender) withObject:nil afterDelay:delayMs / 1000.0];
  }
}

- (void)startHiResOverlayRender
{
  if (self.scrollView.zoomScale < BsnPdfHiResMinZoom || self.bounds.size.width <= 0 || self.bounds.size.height <= 0) {
    [self resetHiResOverlayState];
    return;
  }
  NSArray<BsnPdfHiResRequest *> *requests = [self buildVisibleHiResRequests];
  NSMutableSet<NSNumber *> *visiblePageNumbers = [NSMutableSet set];
  for (BsnPdfHiResRequest *request in requests) [visiblePageNumbers addObject:@(request.pageNumber)];
  [self discardInvisibleHiResOverlays:visiblePageNumbers];
  if (requests.count == 0) return;
  NSURL *fileURL = [self fileURLFromString:self.fileUri];
  if (fileURL == nil) return;

  for (BsnPdfHiResRequest *request in requests) {
    BsnPdfHiResOverlay *current = self.hiResOverlays[@(request.pageNumber)];
    if (current != nil && current.request.targetWidth == request.targetWidth && [self hiResRequest:current.request containsRequest:request]) continue;
    BsnPdfHiResRequest *inFlight = self.hiResInFlight[@(request.pageNumber)];
    if (inFlight != nil && inFlight.targetWidth == request.targetWidth && [self hiResRequest:inFlight containsRequest:request]) continue;

    request.generation = self.hiResGeneration;
    self.hiResInFlight[@(request.pageNumber)] = request;
    __weak typeof(self) weakSelf = self;
    [self.hiResRenderQueue addOperationWithBlock:^{
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (strongSelf == nil) return;
      UIImage *image = [strongSelf renderRegionForRequest:request fileURL:fileURL];
      [[NSOperationQueue mainQueue] addOperationWithBlock:^{
        __strong typeof(weakSelf) currentSelf = weakSelf;
        if (currentSelf == nil) return;
        BsnPdfHiResRequest *currentInFlight = currentSelf.hiResInFlight[@(request.pageNumber)];
        if (request.generation != currentSelf.hiResGeneration || currentInFlight != request || image == nil) {
          if (currentInFlight == request) [currentSelf.hiResInFlight removeObjectForKey:@(request.pageNumber)];
          return;
        }
        BsnPdfHiResOverlay *overlay = [BsnPdfHiResOverlay new];
        overlay.request = request;
        overlay.image = image;
        currentSelf.hiResOverlays[@(request.pageNumber)] = overlay;
        [currentSelf.hiResInFlight removeObjectForKey:@(request.pageNumber)];
        [currentSelf.contentView setNeedsDisplay];
      }];
    }];
  }
}

- (NSArray<BsnPdfHiResRequest *> *)buildVisibleHiResRequests
{
  CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
  CGRect viewport = CGRectMake(self.scrollView.contentOffset.x / zoom, self.scrollView.contentOffset.y / zoom, self.bounds.size.width / zoom, self.bounds.size.height / zoom);
  NSMutableArray<NSDictionary *> *entries = [NSMutableArray array];
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (layout.pageNumber == nil || !CGRectIntersectsRect(viewport, layout.frame)) continue;
    BsnPdfHiResRequest *request = [self buildHiResRequestForLayout:layout viewport:viewport];
    if (request == nil) continue;
    CGFloat overlap = CGRectGetHeight(CGRectIntersection(viewport, layout.frame));
    [entries addObject:@{@"request": request, @"overlap": @(overlap)}];
  }
  [entries sortUsingComparator:^NSComparisonResult(NSDictionary *first, NSDictionary *second) {
    return [second[@"overlap"] compare:first[@"overlap"]];
  }];
  NSMutableArray<BsnPdfHiResRequest *> *requests = [NSMutableArray array];
  for (NSDictionary *entry in entries) [requests addObject:entry[@"request"]];
  return requests;
}

- (nullable BsnPdfHiResRequest *)buildHiResRequestForLayout:(BsnPdfPageLayout *)layout viewport:(CGRect)viewport
{
  CGRect overlap = CGRectIntersection(viewport, layout.frame);
  if (CGRectIsNull(overlap) || overlap.size.width <= 0 || overlap.size.height <= 0) return nil;
  CGFloat rawX = (CGRectGetMinX(overlap) - CGRectGetMinX(layout.frame)) / MAX(1.0, layout.frame.size.width);
  CGFloat rawY = (CGRectGetMinY(overlap) - CGRectGetMinY(layout.frame)) / MAX(1.0, layout.frame.size.height);
  CGFloat rawRight = (CGRectGetMaxX(overlap) - CGRectGetMinX(layout.frame)) / MAX(1.0, layout.frame.size.width);
  CGFloat rawBottom = (CGRectGetMaxY(overlap) - CGRectGetMinY(layout.frame)) / MAX(1.0, layout.frame.size.height);
  CGFloat regionWidth = rawRight - rawX;
  CGFloat regionHeight = rawBottom - rawY;
  CGFloat paddedX = MAX(0, rawX - regionWidth * BsnPdfHiResOverscan);
  CGFloat paddedY = MAX(0, rawY - regionHeight * BsnPdfHiResOverscan);
  CGFloat paddedRight = MIN(1, rawRight + regionWidth * BsnPdfHiResOverscan);
  CGFloat paddedBottom = MIN(1, rawBottom + regionHeight * BsnPdfHiResOverscan);
  BsnPdfHiResRequest *request = [BsnPdfHiResRequest new];
  request.generation = self.hiResGeneration;
  request.pageNumber = layout.pageNumber.integerValue;
  request.targetWidth = MAX([self baseRenderTargetWidth], (NSInteger)llround(layout.frame.size.width * self.scrollView.zoomScale * UIScreen.mainScreen.scale));
  request.regionX = [self quantize:paddedX];
  request.regionY = [self quantize:paddedY];
  request.regionWidth = [self quantize:paddedRight - paddedX];
  request.regionHeight = [self quantize:paddedBottom - paddedY];
  return request;
}

- (nullable UIImage *)renderRegionForRequest:(BsnPdfHiResRequest *)request fileURL:(NSURL *)fileURL
{
  PDFDocument *document = [[PDFDocument alloc] initWithURL:fileURL];
  if (document == nil || request.pageNumber < 1 || request.pageNumber > document.pageCount) return nil;
  PDFPage *page = [document pageAtIndex:request.pageNumber - 1];
  if (page == nil) return nil;
  PDFDisplayBox box = kPDFDisplayBoxCropBox;
  CGRect pageBounds = [page boundsForBox:box];
  if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) {
    box = kPDFDisplayBoxMediaBox;
    pageBounds = [page boundsForBox:box];
  }
  if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) return nil;
  NSInteger fullWidth = MAX(1, request.targetWidth);
  NSInteger fullHeight = MAX(1, (NSInteger)llround((CGFloat)fullWidth * pageBounds.size.height / pageBounds.size.width));
  NSInteger regionPixelWidth = MAX(1, (NSInteger)llround(fullWidth * request.regionWidth));
  NSInteger regionPixelHeight = MAX(1, (NSInteger)llround(fullHeight * request.regionHeight));
  CGSize imageSize = CGSizeMake((CGFloat)regionPixelWidth, (CGFloat)regionPixelHeight);
  CGFloat sourceY = pageBounds.origin.y + pageBounds.size.height * (1.0 - request.regionY - request.regionHeight);
  CGRect sourceRect = CGRectMake(
    pageBounds.origin.x + pageBounds.size.width * request.regionX,
    sourceY,
    pageBounds.size.width * request.regionWidth,
    pageBounds.size.height * request.regionHeight
  );
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.opaque = YES;
  format.scale = 1.0;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:imageSize format:format];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull rendererContext) {
    CGContextRef context = rendererContext.CGContext;
    [[UIColor whiteColor] setFill];
    CGContextFillRect(context, CGRectMake(0, 0, imageSize.width, imageSize.height));
    CGContextSaveGState(context);
    CGContextTranslateCTM(context, 0, imageSize.height);
    CGContextScaleCTM(context, 1.0, -1.0);
    CGContextScaleCTM(context, imageSize.width / MAX(1.0, sourceRect.size.width), imageSize.height / MAX(1.0, sourceRect.size.height));
    CGContextTranslateCTM(context, -sourceRect.origin.x, -sourceRect.origin.y);
    [page drawWithBox:box toContext:context];
    CGContextRestoreGState(context);
  }];
}

- (void)drawHiResOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  if (layout.pageNumber == nil) return;
  BsnPdfHiResOverlay *overlay = self.hiResOverlays[@(layout.pageNumber.integerValue)];
  if (overlay == nil || overlay.request.generation != self.hiResGeneration) return;
  BsnPdfHiResRequest *request = overlay.request;
  CGRect dest = CGRectMake(
    layout.frame.origin.x + layout.frame.size.width * request.regionX,
    layout.frame.origin.y + layout.frame.size.height * request.regionY,
    layout.frame.size.width * request.regionWidth,
    layout.frame.size.height * request.regionHeight
  );
  [overlay.image drawInRect:dest];
}

- (BOOL)hiResRequest:(BsnPdfHiResRequest *)container containsRequest:(BsnPdfHiResRequest *)needed
{
  return needed.regionX >= container.regionX
    && needed.regionY >= container.regionY
    && needed.regionX + needed.regionWidth <= container.regionX + container.regionWidth
    && needed.regionY + needed.regionHeight <= container.regionY + container.regionHeight;
}

- (void)resetHiResOverlayState
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(startHiResOverlayRender) object:nil];
  self.hiResGeneration += 1;
  [self.hiResRenderQueue cancelAllOperations];
  [self.hiResOverlays removeAllObjects];
  [self.hiResInFlight removeAllObjects];
  [self.contentView setNeedsDisplay];
}

- (void)discardInvisibleHiResOverlays:(NSSet<NSNumber *> *)visiblePageNumbers
{
  NSArray<NSNumber *> *keys = self.hiResOverlays.allKeys.copy;
  for (NSNumber *pageNumber in keys) {
    if (![visiblePageNumbers containsObject:pageNumber]) [self.hiResOverlays removeObjectForKey:pageNumber];
  }
  NSArray<NSNumber *> *inFlightKeys = self.hiResInFlight.allKeys.copy;
  for (NSNumber *pageNumber in inFlightKeys) {
    if (![visiblePageNumbers containsObject:pageNumber]) [self.hiResInFlight removeObjectForKey:pageNumber];
  }
}

- (CGFloat)quantize:(CGFloat)value
{
  return round(value * 1000.0) / 1000.0;
}

- (void)scrollToRequestedPageIfNeeded
{
  if (!self.pendingScrollToRequestedPage || self.layouts.count == 0 || self.requestedPage < 1) return;
  BsnPdfPageLayout *target = nil;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (layout.pageNumber != nil && layout.pageNumber.integerValue == self.requestedPage) {
      target = layout;
      break;
    }
  }
  if (target == nil) return;
  self.pendingScrollToRequestedPage = NO;
  self.hasAppliedInitialPage = YES;
  CGFloat zoom = MAX(BsnPdfMinZoom, self.scrollView.zoomScale);
  CGFloat y = target.frame.origin.y * zoom;
  self.scrollView.contentOffset = CGPointMake(0, MIN(MAX(0, y), MAX(0, self.scrollView.contentSize.height - self.bounds.size.height)));
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
  [self scheduleBaseRendersForce:YES];
  [self requestViewportChangedForce:YES];
}

- (void)emitPageChangedIfNeeded
{
  CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
  CGFloat centerY = (self.scrollView.contentOffset.y + self.bounds.size.height * 0.5) / zoom;
  BsnPdfPageLayout *best = nil;
  CGFloat bestDistance = CGFLOAT_MAX;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (layout.pageNumber == nil) continue;
    CGFloat distance = fabs(CGRectGetMidY(layout.frame) - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = layout;
    }
  }
  NSInteger pageNumber = best.pageNumber.integerValue;
  if (pageNumber > 0 && pageNumber != self.lastPageNumber) {
    self.lastPageNumber = pageNumber;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitPageChangedDebounced) object:nil];
    [self performSelector:@selector(emitPageChangedDebounced) withObject:nil afterDelay:0.12];
  }
}

- (void)emitPageChangedDebounced
{
  if (self.lastPageNumber <= 0 || self.lastPageNumber == self.reportedPageNumber) return;
  self.reportedPageNumber = self.lastPageNumber;
  if (self.onPageChanged != nil) self.onPageChanged(@{@"pageNumber": @(self.lastPageNumber)});
}

- (void)requestViewportChangedForce:(BOOL)force
{
  if (force) {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitViewportChangedThrottled) object:nil];
    self.viewportEventScheduled = NO;
    [self emitViewportChangedForce:YES];
    return;
  }
  if (self.viewportEventScheduled) return;
  self.viewportEventScheduled = YES;
  [self performSelector:@selector(emitViewportChangedThrottled) withObject:nil afterDelay:0.032];
}

- (void)emitViewportChangedThrottled
{
  self.viewportEventScheduled = NO;
  [self emitViewportChangedForce:NO];
}

- (void)emitViewportChangedForce:(BOOL)force
{
  if (self.onViewportChanged == nil) return;
  CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
  NSMutableArray *pages = [NSMutableArray array];
  NSMutableArray<NSString *> *keyParts = [NSMutableArray arrayWithArray:@[
    [NSString stringWithFormat:@"%ld", (long)llround(self.bounds.size.width)],
    [NSString stringWithFormat:@"%ld", (long)llround(self.bounds.size.height)],
    [NSString stringWithFormat:@"%ld", (long)llround(zoom * 1000.0)],
    [NSString stringWithFormat:@"%ld", (long)llround(self.scrollView.contentOffset.y)],
    [NSString stringWithFormat:@"%ld", (long)llround(self.scrollView.contentOffset.x)],
  ]];
  CGRect viewport = CGRectMake(self.scrollView.contentOffset.x / zoom, self.scrollView.contentOffset.y / zoom, self.bounds.size.width / zoom, self.bounds.size.height / zoom);
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (!CGRectIntersectsRect(CGRectInset(viewport, 0, -layout.frame.size.height), layout.frame)) continue;
    CGFloat left = layout.frame.origin.x * zoom - self.scrollView.contentOffset.x;
    CGFloat top = layout.frame.origin.y * zoom - self.scrollView.contentOffset.y;
    [pages addObject:@{
      @"id": layout.pageId ?: @"page",
      @"kind": layout.kind ?: @"pdf",
      @"label": layout.label ?: @"Page",
      @"pageNumber": layout.pageNumber ?: (id)kCFNull,
      @"generatedPageId": layout.generatedPageId ?: (id)kCFNull,
      @"left": @(left),
      @"top": @(top),
      @"width": @(layout.frame.size.width * zoom),
      @"height": @(layout.frame.size.height * zoom),
      @"pageWidth": @(layout.logicalSize.width),
      @"pageHeight": @(layout.logicalSize.height),
    }];
    [keyParts addObject:[NSString stringWithFormat:@"%@:%ld:%ld:%ld:%ld", layout.pageId ?: @"page", (long)llround(left), (long)llround(top), (long)llround(layout.frame.size.width * zoom), (long)llround(layout.frame.size.height * zoom)]];
  }
  NSString *eventKey = [keyParts componentsJoinedByString:@"|"];
  if (!force && [eventKey isEqualToString:self.lastViewportEventKey]) return;
  self.lastViewportEventKey = eventKey;
  self.onViewportChanged(@{
    @"scale": @(zoom),
    @"scrollY": @(self.scrollView.contentOffset.y),
    @"translateX": @(-self.scrollView.contentOffset.x),
    @"viewportWidth": @(self.bounds.size.width),
    @"viewportHeight": @(self.bounds.size.height),
    @"contentHeight": @(self.scrollView.contentSize.height),
    @"pages": pages,
  });
}

- (void)updateInkInputEnabled
{
  BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
  BOOL eraseTool = [self.inkTool isEqualToString:@"erase"];
  self.inkInputView.userInteractionEnabled = NO;
  self.fingerInkPanGesture.enabled = drawingTool && (self.fingerDrawingEnabled || eraseTool);
  self.pencilInkPanGesture.enabled = drawingTool && !self.fingerDrawingEnabled && !eraseTool;
  self.scrollView.panGestureRecognizer.enabled = YES;
}

- (BOOL)shouldAcceptTouch:(UITouch *)touch
{
  if ([self.inkTool isEqualToString:@"erase"]) return YES;
  if (self.fingerDrawingEnabled) return YES;
  if (@available(iOS 9.1, *)) {
    return touch.type == UITouchTypePencil;
  }
  return YES;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  return NO;
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gestureRecognizer
{
  if (gestureRecognizer == self.fingerInkPanGesture) {
    BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
    return drawingTool && (self.fingerDrawingEnabled || [self.inkTool isEqualToString:@"erase"]) && self.fingerInkPanGesture.numberOfTouches <= 1;
  }
  if (gestureRecognizer == self.pencilInkPanGesture) {
    BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
    return drawingTool && !self.fingerDrawingEnabled && ![self.inkTool isEqualToString:@"erase"];
  }
  return YES;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch
{
  if (gestureRecognizer == self.fingerInkPanGesture) {
    if (@available(iOS 9.1, *)) return touch.type != UITouchTypePencil;
    return YES;
  }
  if (gestureRecognizer == self.pencilInkPanGesture) {
    if (@available(iOS 9.1, *)) return touch.type == UITouchTypePencil;
    return YES;
  }
  return YES;
}

- (void)handleFingerInkPan:(UIPanGestureRecognizer *)gesture
{
  [self handleInkPan:gesture];
}

- (void)handlePencilInkPan:(UIPanGestureRecognizer *)gesture
{
  [self handleInkPan:gesture];
}

- (void)handleInkPan:(UIPanGestureRecognizer *)gesture
{
  CGPoint point = [gesture locationInView:self];
  if (gesture.state == UIGestureRecognizerStateBegan) {
    [self beginInkAtPoint:point];
  } else if (gesture.state == UIGestureRecognizerStateChanged) {
    [self moveInkAtPoint:point];
  } else if (gesture.state == UIGestureRecognizerStateEnded) {
    [self endInkWithCommit:YES];
  } else if (gesture.state == UIGestureRecognizerStateCancelled || gesture.state == UIGestureRecognizerStateFailed) {
    [self endInkWithCommit:NO];
  }
}

- (nullable NSDictionary *)hitPagePointAtViewPoint:(CGPoint)viewPoint
{
  CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
  CGPoint contentPoint = CGPointMake((viewPoint.x + self.scrollView.contentOffset.x) / zoom, (viewPoint.y + self.scrollView.contentOffset.y) / zoom);
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (!CGRectContainsPoint(layout.frame, contentPoint)) continue;
    CGFloat x = (contentPoint.x - layout.frame.origin.x) / MAX(1.0, layout.frame.size.width) * layout.logicalSize.width;
    CGFloat y = (contentPoint.y - layout.frame.origin.y) / MAX(1.0, layout.frame.size.height) * layout.logicalSize.height;
    NSMutableDictionary *point = [@{
      @"x": @(x),
      @"y": @(y),
      @"pageWidth": @(layout.logicalSize.width),
      @"pageHeight": @(layout.logicalSize.height),
    } mutableCopy];
    if (layout.pageNumber != nil) point[@"pageNumber"] = layout.pageNumber;
    if (layout.generatedPageId != nil) point[@"generatedPageId"] = layout.generatedPageId;
    return @{@"layout": layout, @"point": point};
  }
  return nil;
}

- (void)beginInkAtPoint:(CGPoint)viewPoint
{
  NSDictionary *hit = [self hitPagePointAtViewPoint:viewPoint];
  if (hit == nil) return;
  BsnPdfPageLayout *layout = hit[@"layout"];
  NSDictionary *point = hit[@"point"];
  if ([self.inkTool isEqualToString:@"erase"]) {
    NSString *strokeId = [self hitStrokeIdAtPoint:point inLayout:layout];
    if (strokeId != nil && self.onRemoveInkStroke != nil) self.onRemoveInkStroke(@{@"strokeId": strokeId});
    return;
  }

  NSString *style = [self.inkTool isEqualToString:@"highlight"] ? @"highlight" : ([self isShapeTool:self.inkTool] ? @"shape" : @"pen");
  self.activeStroke = [@{
    @"id": [NSString stringWithFormat:@"%lld-%@", (long long)(NSDate.date.timeIntervalSince1970 * 1000), NSUUID.UUID.UUIDString],
    @"points": [@[point] mutableCopy],
    @"color": self.penColor ?: @"#111827",
    @"width": @(self.penWidth),
    @"style": style,
    @"brush": self.brushType ?: @"pen",
    @"linePattern": self.linePattern ?: @"solid",
    @"pageWidth": @(layout.logicalSize.width),
    @"pageHeight": @(layout.logicalSize.height),
  } mutableCopy];
  if ([style isEqualToString:@"shape"]) self.activeStroke[@"shape"] = self.inkTool;
  if (layout.pageNumber != nil) self.activeStroke[@"pageNumber"] = layout.pageNumber;
  if (layout.generatedPageId != nil) self.activeStroke[@"generatedPageId"] = layout.generatedPageId;
  [self redrawContent];
}

- (void)moveInkAtPoint:(CGPoint)viewPoint
{
  NSDictionary *hit = [self hitPagePointAtViewPoint:viewPoint];
  if (hit == nil) return;
  BsnPdfPageLayout *layout = hit[@"layout"];
  NSDictionary *point = hit[@"point"];
  if ([self.inkTool isEqualToString:@"erase"]) {
    NSString *strokeId = [self hitStrokeIdAtPoint:point inLayout:layout];
    if (strokeId != nil && self.onRemoveInkStroke != nil) self.onRemoveInkStroke(@{@"strokeId": strokeId});
    return;
  }
  NSMutableArray *points = self.activeStroke[@"points"];
  if (![points isKindOfClass:NSMutableArray.class]) return;
  if ([self.activeStroke[@"style"] isEqualToString:@"shape"]) {
    if (points.count <= 1) [points addObject:point]; else points[1] = point;
  } else {
    NSDictionary *last = points.lastObject;
    CGFloat dx = [last[@"x"] doubleValue] - [point[@"x"] doubleValue];
    CGFloat dy = [last[@"y"] doubleValue] - [point[@"y"] doubleValue];
    if (last == nil || hypot(dx, dy) > 1.5) [points addObject:point];
  }
  [self redrawContent];
}

- (void)endInkWithCommit:(BOOL)commit
{
  NSDictionary *stroke = self.activeStroke;
  self.activeStroke = nil;
  NSArray *points = stroke[@"points"];
  if (commit && stroke != nil && points.count > 1 && self.onCommitInkStroke != nil) {
    self.onCommitInkStroke(stroke);
  }
  [self redrawContent];
}

- (BOOL)isShapeTool:(NSString *)tool
{
  return [@[@"line", @"arrow", @"rect", @"ellipse"] containsObject:tool ?: @""];
}

- (void)drawInkForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  NSMutableArray *strokes = [NSMutableArray arrayWithArray:self.inkStrokes ?: @[]];
  if (self.activeStroke != nil) [strokes addObject:self.activeStroke];
  for (NSDictionary *stroke in strokes) {
    if (![self stroke:stroke belongsToLayout:layout]) continue;
    [self drawStroke:stroke layout:layout context:context];
  }
}

- (BOOL)stroke:(NSDictionary *)stroke belongsToLayout:(BsnPdfPageLayout *)layout
{
  NSString *generatedId = [RCTConvert NSString:stroke[@"generatedPageId"]];
  if (layout.generatedPageId != nil) return [generatedId isEqualToString:layout.generatedPageId];
  NSNumber *pageNumber = stroke[@"pageNumber"] != nil ? [RCTConvert NSNumber:stroke[@"pageNumber"]] : nil;
  return layout.pageNumber != nil && pageNumber.integerValue == layout.pageNumber.integerValue;
}

- (void)drawStroke:(NSDictionary *)stroke layout:(BsnPdfPageLayout *)layout context:(CGContextRef)context
{
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return;
  UIColor *color = [self colorFromHex:[RCTConvert NSString:stroke[@"color"]] ?: @"#111827"];
  CGFloat width = MAX(1.0, [stroke[@"width"] doubleValue]);
  NSString *style = [RCTConvert NSString:stroke[@"style"]] ?: @"pen";
  CGContextSaveGState(context);
  CGContextSetStrokeColorWithColor(context, [color colorWithAlphaComponent:[style isEqualToString:@"highlight"] ? 0.36 : 1.0].CGColor);
  CGContextSetLineWidth(context, width);
  CGContextSetLineCap(context, kCGLineCapRound);
  CGContextSetLineJoin(context, kCGLineJoinRound);
  NSString *linePattern = [RCTConvert NSString:stroke[@"linePattern"]] ?: @"solid";
  if ([linePattern isEqualToString:@"dashed"]) {
    CGFloat lengths[] = { width * 4.0, width * 2.5 };
    CGContextSetLineDash(context, 0, lengths, 2);
  } else if ([linePattern isEqualToString:@"dotted"]) {
    CGFloat lengths[] = { width, width * 1.8 };
    CGContextSetLineDash(context, 0, lengths, 2);
  }

  if ([style isEqualToString:@"shape"] && points.count >= 2) {
    [self drawShapeStroke:stroke points:points layout:layout context:context];
    CGContextRestoreGState(context);
    return;
  }

  for (NSInteger index = 0; index < points.count; index += 1) {
    CGPoint point = [self screenPointForInkPoint:points[index] layout:layout];
    if (index == 0) CGContextMoveToPoint(context, point.x, point.y); else CGContextAddLineToPoint(context, point.x, point.y);
  }
  CGContextStrokePath(context);
  CGContextRestoreGState(context);
}

- (void)drawShapeStroke:(NSDictionary *)stroke points:(NSArray *)points layout:(BsnPdfPageLayout *)layout context:(CGContextRef)context
{
  CGPoint start = [self screenPointForInkPoint:points.firstObject layout:layout];
  CGPoint end = [self screenPointForInkPoint:points.lastObject layout:layout];
  NSString *shape = [RCTConvert NSString:stroke[@"shape"]] ?: @"line";
  CGRect rect = CGRectMake(MIN(start.x, end.x), MIN(start.y, end.y), fabs(end.x - start.x), fabs(end.y - start.y));
  if ([shape isEqualToString:@"rect"]) {
    CGContextStrokeRect(context, rect);
  } else if ([shape isEqualToString:@"ellipse"]) {
    CGContextStrokeEllipseInRect(context, rect);
  } else {
    CGContextMoveToPoint(context, start.x, start.y);
    CGContextAddLineToPoint(context, end.x, end.y);
    CGContextStrokePath(context);
    if ([shape isEqualToString:@"arrow"]) [self drawArrowFrom:start to:end context:context];
  }
}

- (void)drawArrowFrom:(CGPoint)start to:(CGPoint)end context:(CGContextRef)context
{
  CGFloat angle = atan2(end.y - start.y, end.x - start.x);
  CGFloat length = 14.0;
  CGPoint left = CGPointMake(end.x + cos(angle + M_PI * 0.82) * length, end.y + sin(angle + M_PI * 0.82) * length);
  CGPoint right = CGPointMake(end.x + cos(angle - M_PI * 0.82) * length, end.y + sin(angle - M_PI * 0.82) * length);
  CGContextMoveToPoint(context, end.x, end.y);
  CGContextAddLineToPoint(context, left.x, left.y);
  CGContextMoveToPoint(context, end.x, end.y);
  CGContextAddLineToPoint(context, right.x, right.y);
  CGContextStrokePath(context);
}

- (CGPoint)screenPointForInkPoint:(NSDictionary *)point layout:(BsnPdfPageLayout *)layout
{
  NSNumber *pointPageWidth = point[@"pageWidth"];
  NSNumber *pointPageHeight = point[@"pageHeight"];
  CGFloat pageWidth = MAX(1.0, pointPageWidth != nil ? pointPageWidth.doubleValue : layout.logicalSize.width);
  CGFloat pageHeight = MAX(1.0, pointPageHeight != nil ? pointPageHeight.doubleValue : layout.logicalSize.height);
  CGFloat x = [point[@"x"] doubleValue] / pageWidth * layout.frame.size.width + layout.frame.origin.x;
  CGFloat y = [point[@"y"] doubleValue] / pageHeight * layout.frame.size.height + layout.frame.origin.y;
  return CGPointMake(x, y);
}

- (NSString *)hitStrokeIdAtPoint:(NSDictionary *)point inLayout:(BsnPdfPageLayout *)layout
{
  CGFloat radius = MAX(10.0, self.penWidth * 2.5);
  for (NSDictionary *stroke in self.inkStrokes.reverseObjectEnumerator) {
    if (![self stroke:stroke belongsToLayout:layout]) continue;
    NSArray *points = stroke[@"points"];
    for (NSDictionary *candidate in points) {
      CGFloat dx = [candidate[@"x"] doubleValue] - [point[@"x"] doubleValue];
      CGFloat dy = [candidate[@"y"] doubleValue] - [point[@"y"] doubleValue];
      if (hypot(dx, dy) <= radius) return [RCTConvert NSString:stroke[@"id"]];
    }
  }
  return nil;
}

- (UIColor *)colorFromHex:(NSString *)hex
{
  NSString *clean = [[hex stringByReplacingOccurrencesOfString:@"#" withString:@""] uppercaseString];
  if (clean.length != 6) return UIColor.blackColor;
  unsigned int rgb = 0;
  [[NSScanner scannerWithString:clean] scanHexInt:&rgb];
  return [UIColor colorWithRed:((rgb >> 16) & 0xFF) / 255.0 green:((rgb >> 8) & 0xFF) / 255.0 blue:(rgb & 0xFF) / 255.0 alpha:1.0];
}

- (void)redrawContent
{
  [self.contentView setNeedsDisplay];
}

@end

@interface BsnPdfViewportViewManager : RCTViewManager
@end

@implementation BsnPdfViewportViewManager

RCT_EXPORT_MODULE(BsnPdfViewportView)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [BsnPdfViewportView new];
}

RCT_EXPORT_VIEW_PROPERTY(fileUri, NSString)
RCT_EXPORT_VIEW_PROPERTY(requestedPage, NSInteger)
RCT_REMAP_VIEW_PROPERTY(page, requestedPage, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(notebookPages, NSArray)
RCT_EXPORT_VIEW_PROPERTY(inkTool, NSString)
RCT_EXPORT_VIEW_PROPERTY(fingerDrawingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(penColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(penWidth, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(brushType, NSString)
RCT_EXPORT_VIEW_PROPERTY(linePattern, NSString)
RCT_EXPORT_VIEW_PROPERTY(brushSettings, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(inkStrokes, NSArray)
RCT_EXPORT_VIEW_PROPERTY(onDocumentLoaded, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPageChanged, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onViewportChanged, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCommitInkStroke, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onRemoveInkStroke, RCTDirectEventBlock)

@end
