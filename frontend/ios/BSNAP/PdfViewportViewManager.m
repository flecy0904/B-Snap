#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <PDFKit/PDFKit.h>
#import <ImageIO/ImageIO.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTComponent.h>
#import <React/RCTConvert.h>
#import <React/RCTViewManager.h>

static CGFloat const BsnPdfPageGap = 6.0;
static CGFloat const BsnPdfMinHorizontalPageInset = 0.0;
static CGFloat const BsnPdfMaxHorizontalPageInset = 0.0;
static CGFloat const BsnPdfFitVerticalInset = 2.0;
static CGFloat const BsnPdfMinZoom = 1.0;
static CGFloat const BsnPdfMaxZoom = 4.0;
static CGFloat const BsnPdfHiResMinZoom = 1.35;
static CGFloat const BsnPdfHiResOverscan = 0.3;
static CGFloat const BsnPdfDeferredWidthLayoutDelay = 0.16;
static NSInteger const BsnPdfRenderTargetWidthQuantum = 64;
static NSInteger const BsnPdfMaxBaseRenderTargetWidth = 1200;
static NSInteger const BsnPdfMaxHiResRenderTargetWidth = 2400;
static CGFloat const BsnPdfMaxPageAspectRatio = 12.0;
static CGFloat const BsnPdfMaxDecodedImagePixel = 2048.0;
static BOOL const BsnPdfPageDebugLoggingEnabled = NO;

#define BsnPdfPageDebugLog(...) do { if (BsnPdfPageDebugLoggingEnabled) NSLog(__VA_ARGS__); } while (0)
#define BsnPdfPerfLog(view, ...) do { if ((view).perfLoggingEnabled) NSLog(__VA_ARGS__); } while (0)
#define BsnPdfRenderDebugLog(view, ...) do { if ((view).renderDebugLoggingEnabled) NSLog(__VA_ARGS__); } while (0)

static CGRect BsnPdfUnionDirtyRects(CGRect first, CGRect second)
{
  if (CGRectIsNull(first)) return second;
  if (CGRectIsNull(second)) return first;
  return CGRectUnion(first, second);
}

static NSMutableDictionary<NSString *, NSDictionary *> *BsnPdfSavedViewportAnchors(void)
{
  static NSMutableDictionary<NSString *, NSDictionary *> *anchors;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    anchors = [NSMutableDictionary dictionary];
  });
  return anchors;
}

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

@interface BsnPdfTextAnnotationView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@property (nonatomic, copy) NSString *annotationId;
@property (nonatomic, strong) UITextView *textView;
@property (nonatomic, strong) UIView *toolbarView;
@property (nonatomic, strong) UIButton *minusButton;
@property (nonatomic, strong) UIButton *plusButton;
@property (nonatomic, strong) UIButton *doneButton;
@property (nonatomic, strong) UIButton *deleteButton;
@property (nonatomic, strong) UIView *resizeHandle;
@property (nonatomic) CGRect startFrame;
@property (nonatomic) BOOL active;
- (instancetype)initWithOwner:(BsnPdfViewportView *)owner annotationId:(NSString *)annotationId;
- (void)setActive:(BOOL)active;
- (void)configureAccessory;
@end

@interface BsnPdfPageReferenceView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@property (nonatomic, copy) NSString *referenceId;
@property (nonatomic, strong) UIButton *stickerButton;
@property (nonatomic, strong) UIView *popoverView;
@property (nonatomic, strong) UILabel *pageLabel;
@property (nonatomic, strong) UILabel *titleLabel;
@property (nonatomic, strong) UIImageView *imageView;
@property (nonatomic, strong) UILabel *summaryLabel;
@property (nonatomic, strong) UIButton *closeButton;
@property (nonatomic, strong) UIButton *askButton;
@property (nonatomic) BOOL open;
- (instancetype)initWithOwner:(BsnPdfViewportView *)owner referenceId:(NSString *)referenceId;
- (void)configureWithReference:(NSDictionary *)reference image:(nullable UIImage *)image count:(NSInteger)count open:(BOOL)open;
@end

@interface BsnPdfContentView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfEditOverlayView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfCustomCoreView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfTiledLayer : CATiledLayer
@end

@interface BsnPdfLiveInkView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfInkInputView : UIView
@property (nonatomic, weak) BsnPdfViewportView *owner;
@end

@interface BsnPdfNativeInkGestureRecognizer : UIGestureRecognizer
@property (nonatomic, weak) BsnPdfViewportView *owner;
@property (nonatomic) BOOL acceptsPencil;
@property (nonatomic) BOOL acceptsFinger;
@property (nonatomic, strong, nullable) UITouch *activeTouch;
@end

@interface BsnPdfViewportView : UIView <UIScrollViewDelegate, UIGestureRecognizerDelegate, UITextViewDelegate>
@property (nonatomic, copy, nullable) NSString *fileUri;
@property (nonatomic) NSInteger requestedPage;
@property (nonatomic) NSInteger requestedPageSerial;
@property (nonatomic, copy) NSArray<NSDictionary *> *notebookPages;
@property (nonatomic, copy) NSString *inkTool;
@property (nonatomic) BOOL fingerDrawingEnabled;
@property (nonatomic, copy) NSString *penColor;
@property (nonatomic) CGFloat penWidth;
@property (nonatomic, copy) NSString *brushType;
@property (nonatomic, copy) NSString *linePattern;
@property (nonatomic, copy) NSString *eraserMode;
@property (nonatomic) CGFloat eraserWidth;
@property (nonatomic, copy, nullable) NSDictionary *brushSettings;
@property (nonatomic, copy) NSArray<NSDictionary *> *inkStrokes;
@property (nonatomic, copy) NSArray<NSDictionary *> *textAnnotations;
@property (nonatomic, copy) NSArray<NSDictionary *> *imageAnnotations;
@property (nonatomic, copy) NSArray<NSDictionary *> *pageCaptureReferences;
@property (nonatomic, copy, nullable) NSString *openPageCaptureReferenceId;
@property (nonatomic, copy) NSArray<NSString *> *hiddenTextAnnotationIds;
@property (nonatomic, copy) NSArray<NSString *> *selectionPreviewStrokeIds;
@property (nonatomic) NSInteger selectionPreviewPageNumber;
@property (nonatomic, copy, nullable) NSString *selectionPreviewGeneratedPageId;
@property (nonatomic) CGFloat selectionPreviewOffsetX;
@property (nonatomic) CGFloat selectionPreviewOffsetY;
@property (nonatomic) NSInteger selectionOverlayPageNumber;
@property (nonatomic, copy, nullable) NSString *selectionOverlayGeneratedPageId;
@property (nonatomic) CGFloat selectionOverlayX;
@property (nonatomic) CGFloat selectionOverlayY;
@property (nonatomic) CGFloat selectionOverlayWidth;
@property (nonatomic) CGFloat selectionOverlayHeight;
@property (nonatomic) CGFloat selectionOverlayPageWidth;
@property (nonatomic) CGFloat selectionOverlayPageHeight;
@property (nonatomic) BOOL selectionOverlayDraft;
@property (nonatomic) BOOL selectionGestureEnabled;
@property (nonatomic, copy) NSString *selectionMode;
@property (nonatomic, copy) NSString *selectionOverlayMode;
@property (nonatomic, copy) NSArray<NSDictionary *> *selectionOverlayPath;
@property (nonatomic) BOOL selectionMenuEnabled;
@property (nonatomic) BOOL selectionMenuEditable;
@property (nonatomic) BOOL textGestureEnabled;
@property (nonatomic) BOOL customViewportCoreEnabled;
@property (nonatomic) BOOL perfLoggingEnabled;
@property (nonatomic) BOOL renderDebugLoggingEnabled;
@property (nonatomic, strong) UIScrollView *scrollView;
@property (nonatomic, strong, nullable) PDFDocument *document;
@property (nonatomic, copy) NSArray<BsnPdfPageLayout *> *layouts;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onDocumentLoaded;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onPageChanged;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onViewportChanged;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onCommitInkStroke;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onRemoveInkStroke;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onReplaceInkStrokes;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onSelectionGesture;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onSelectionAction;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onTextAnnotationAdd;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onTextAnnotationChange;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onTextAnnotationRemove;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onPageCaptureReferenceAction;
- (void)drawInkForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (void)drawImageAnnotationsForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (void)drawSelectionOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (void)drawSelectionMenuForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (void)drawDocumentPagesInContext:(CGContextRef)context dirtyRect:(CGRect)rect drawEditing:(BOOL)drawEditing;
- (void)drawCustomCoreInContext:(CGContextRef)context dirtyRect:(CGRect)rect;
- (void)drawLiveInkInContext:(CGContextRef)context dirtyRect:(CGRect)dirtyRect;
- (NSArray<NSDictionary *> *)visibleInkStrokesIncludingPending;
- (nullable UIImage *)baseImageForPageNumber:(NSInteger)pageNumber;
- (void)requestBaseRenderForLayout:(BsnPdfPageLayout *)layout priority:(NSInteger)priority;
- (void)drawHiResOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (NSString *)emptyStateMessage;
- (nullable NSDictionary *)hitPagePointAtViewPoint:(CGPoint)viewPoint;
- (BOOL)shouldAcceptTouch:(UITouch *)touch;
- (void)interruptViewportMotionForUserTouch;
- (void)beginInkAtPoint:(CGPoint)viewPoint;
- (void)moveInkAtPoint:(CGPoint)viewPoint;
- (void)moveInkAtPoint:(CGPoint)viewPoint predicted:(BOOL)predicted;
- (void)endInkWithCommit:(BOOL)commit;
- (void)redrawContent;
- (void)scheduleDeferredInkCommit:(NSDictionary *)stroke;
- (void)flushDeferredInkCommits;
- (void)clearRetainedLiveStroke;
- (void)setContentNeedsDisplaySafely;
- (void)setContentNeedsDisplayInRectSafely:(CGRect)rect;
- (void)setContentNeedsDisplayForPageNumber:(NSInteger)pageNumber;
- (void)setContentNeedsDisplayForHiResRequest:(BsnPdfHiResRequest *)request;
- (void)setContentNeedsDisplayForHiResOverlay:(BsnPdfHiResOverlay *)overlay;
- (void)setContentNeedsDisplayForRectChangeFrom:(CGRect)oldRect to:(CGRect)newRect;
- (void)flushDeferredContentInvalidation;
@end

@interface BsnPdfViewportView ()
@property (nonatomic, strong) BsnPdfContentView *contentView;
@property (nonatomic, strong) BsnPdfEditOverlayView *editOverlayView;
@property (nonatomic, strong) BsnPdfCustomCoreView *customCoreView;
@property (nonatomic, strong) UIView *customNativeSubviewLayer;
@property (nonatomic, strong) BsnPdfLiveInkView *liveInkView;
@property (nonatomic, strong) BsnPdfInkInputView *inkInputView;
@property (nonatomic, strong) UIPanGestureRecognizer *viewportPanGesture;
@property (nonatomic, strong) UIPinchGestureRecognizer *viewportPinchGesture;
@property (nonatomic, strong) UIPanGestureRecognizer *selectionGesture;
@property (nonatomic, strong) UITapGestureRecognizer *selectionTapGesture;
@property (nonatomic, strong) UITapGestureRecognizer *textTapGesture;
@property (nonatomic, strong) BsnPdfNativeInkGestureRecognizer *pencilInkPanGesture;
@property (nonatomic, strong) BsnPdfNativeInkGestureRecognizer *fingerInkPanGesture;
@property (nonatomic, strong) NSOperationQueue *baseRenderQueue;
@property (nonatomic, strong) NSOperationQueue *hiResRenderQueue;
@property (nonatomic, strong) NSCache<NSString *, UIImage *> *baseBitmapCache;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, UIImage *> *latestBaseImageByPageNumber;
@property (nonatomic, strong) NSMutableSet<NSString *> *baseRenderRequests;
@property (nonatomic, strong) NSMutableSet<NSString *> *wantedBaseRenderKeys;
@property (nonatomic, strong) NSMutableSet<NSString *> *startedBaseRenderKeys;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, BsnPdfHiResOverlay *> *hiResOverlays;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, BsnPdfHiResRequest *> *hiResInFlight;
@property (nonatomic, strong, nullable) NSMutableDictionary *activeStroke;
@property (nonatomic, strong, nullable) NSDictionary *activePredictedStroke;
@property (nonatomic, strong, nullable) NSDictionary *retainedLiveStroke;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *pendingCommittedStrokes;
@property (nonatomic, strong) NSMutableSet<NSString *> *pendingRemovedStrokeIds;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *deferredCommitStrokes;
@property (nonatomic, strong) NSMutableDictionary<NSString *, BsnPdfTextAnnotationView *> *textAnnotationViews;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *textAnnotationById;
@property (nonatomic, strong) NSMutableDictionary<NSString *, BsnPdfPageReferenceView *> *pageReferenceViews;
@property (nonatomic, strong) NSMutableDictionary<NSString *, UIImage *> *imageAnnotationCache;
@property (nonatomic, strong) NSMutableSet<NSString *> *imageAnnotationLoadsInFlight;
@property (nonatomic, strong) NSSet<NSString *> *hiddenTextAnnotationIdSet;
@property (nonatomic, copy, nullable) NSString *activeTextAnnotationId;
@property (nonatomic) BOOL deferredCommitScheduled;
@property (nonatomic) BOOL deferredContentInvalidation;
@property (nonatomic) CGRect deferredContentInvalidationRect;
@property (nonatomic) BOOL deferredEditOverlayInvalidation;
@property (nonatomic) CGRect deferredEditOverlayInvalidationRect;
@property (nonatomic) CGRect lastActiveStrokeDirtyRect;
@property (nonatomic) CGRect retainedLiveStrokeDirtyRect;
@property (nonatomic, strong, nullable) NSSet<NSString *> *eraserOriginalStrokeIds;
@property (nonatomic, strong, nullable) NSDictionary *lastEraserPoint;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSValue *> *strokeBoundsCache;
@property (nonatomic, strong) NSSet<NSString *> *selectionPreviewStrokeIdSet;
@property (nonatomic, strong, nullable) NSMutableDictionary *lastViewportPayload;
@property (nonatomic, copy, nullable) NSDictionary *pendingLayoutTransitionAnchor;
@property (nonatomic, copy, nullable) NSString *loadErrorMessage;
@property (nonatomic) NSInteger lastPageNumber;
@property (nonatomic) NSInteger reportedPageNumber;
@property (nonatomic) BOOL pendingScrollToRequestedPage;
@property (nonatomic) BOOL hasAppliedInitialPage;
@property (nonatomic) NSInteger appliedRequestedPageSerial;
@property (nonatomic) BOOL viewportEventScheduled;
@property (nonatomic) BOOL inkInteractionActive;
@property (nonatomic) NSInteger renderGeneration;
@property (nonatomic) NSInteger hiResGeneration;
@property (nonatomic) NSInteger baseRenderDirection;
@property (nonatomic) CGFloat lastContentOffsetY;
@property (nonatomic) CGFloat coreScale;
@property (nonatomic) CGFloat coreScrollYDocument;
@property (nonatomic) CGFloat coreTranslateX;
@property (nonatomic) CGFloat coreContentHeight;
@property (nonatomic) CGFloat coreContentWidth;
@property (nonatomic) BOOL syncingCustomViewportToScrollView;
@property (nonatomic) CGFloat pinchStartZoom;
@property (nonatomic) CGPoint pinchFocusContentPoint;
@property (nonatomic, copy, nullable) NSDictionary *pinchFocusAnchor;
@property (nonatomic) CGPoint pinchLastFocusViewPoint;
@property (nonatomic) BOOL viewportPinchActive;
@property (nonatomic) BOOL viewportPanActive;
@property (nonatomic) CGPoint inertiaVelocity;
@property (nonatomic) CFTimeInterval inertiaLastTimestamp;
@property (nonatomic, strong, nullable) CADisplayLink *inertiaDisplayLink;
@property (nonatomic) CGSize lastViewportSize;
@property (nonatomic) CGSize pendingDeferredLayoutSize;
@property (nonatomic, copy, nullable) NSDictionary *pendingCustomLayoutAnchor;
@property (nonatomic) CGPoint pendingCustomLayoutViewPoint;
@property (nonatomic, copy, nullable) NSString *pendingCustomLayoutReason;
@property (nonatomic) BOOL deferredWidthLayoutPending;
@property (nonatomic) CFTimeInterval suppressAnchorSaveUntil;
@property (nonatomic) CFTimeInterval suppressInkViewportEventsUntil;
@property (nonatomic) CFTimeInterval suppressScrollPageEventsUntil;
@property (nonatomic) NSInteger protectedPageNumber;
@property (nonatomic) CFTimeInterval lastPerfLogTime;
@property (nonatomic) CFTimeInterval lastScrollDebugLogTime;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *renderDebugLastLogTimes;
@property (nonatomic) NSInteger baseCacheHits;
@property (nonatomic) NSInteger baseCacheMisses;
@property (nonatomic) NSInteger baseRenderCompletedCount;
@property (nonatomic) NSInteger hiResRenderCompletedCount;
@property (nonatomic) BOOL restoringViewportAnchor;
@property (nonatomic, copy) NSString *lastBaseRenderScheduleKey;
@property (nonatomic, copy) NSString *lastViewportEventKey;
@property (nonatomic, copy) NSString *pendingPageChangeSource;
@property (nonatomic, copy, nullable) NSString *activeSelectionAction;
@property (nonatomic, copy, nullable) NSString *activeSelectionResizeCorner;
@property (nonatomic) BOOL selectionColorPickerOpen;
- (nullable NSDictionary *)captureViewportAnchor;
- (void)saveViewportAnchor;
- (void)restoreViewportAnchor:(NSDictionary *)anchor;
- (BOOL)restoreAnchorIfNeededForLayoutResetScroll;
- (BOOL)restoreProtectedPageAfterProgrammaticScrollCandidate:(NSInteger)pageNumber source:(NSString *)source;
- (BOOL)restoreStablePageIfNeededForLayoutResetCandidate:(NSInteger)pageNumber source:(NSString *)source;
- (BOOL)isSuppressingProgrammaticLayout;
- (NSInteger)stablePageForProgrammaticLayout;
- (NSInteger)savedAnchorPageNumber;
- (BOOL)scrollToPageNumber:(NSInteger)pageNumber reason:(NSString *)reason;
- (void)applyRequestedPageIfNeeded;
- (void)performDeferredWidthLayoutRebuild;
- (BOOL)shouldDeferWidthOnlyLayoutFromSize:(CGSize)oldSize toSize:(CGSize)newSize;
- (NSInteger)quantizedRenderTargetWidth:(NSInteger)targetWidth;
- (CGRect)safeBoundsForPage:(PDFPage *)page displayBox:(PDFDisplayBox *)displayBox;
- (CGSize)safeLogicalSizeForPage:(PDFPage *)page;
- (NSInteger)pageNumberNearContentPoint:(CGPoint)contentPoint;
- (void)scheduleBaseRendersForce:(BOOL)force;
- (void)pruneBaseRenderQueueForWantedKeys:(NSSet<NSString *> *)wantedKeys;
- (NSArray<NSNumber *> *)visibleRenderPriorityIndexes;
- (NSString *)hiResRenderKeyForRequest:(BsnPdfHiResRequest *)request;
- (void)pruneHiResRenderQueueForWantedKeys:(NSSet<NSString *> *)wantedKeys;
- (void)requestHiResOverlayAfterDelay:(NSTimeInterval)delayMs;
- (void)requestViewportChangedForce:(BOOL)force;
- (void)emitViewportChangedThrottled;
- (void)emitViewportChangedForce:(BOOL)force;
- (CGFloat)viewportScale;
- (CGPoint)viewportContentOffset;
- (CGSize)viewportContentSize;
- (CGPoint)contentPointForViewportPoint:(CGPoint)viewPoint;
- (nullable NSDictionary *)captureCustomViewportAnchorAtViewPoint:(CGPoint)viewPoint;
- (CGPoint)contentPointForCustomViewportAnchor:(NSDictionary *)anchor fallbackContentPoint:(CGPoint)fallbackContentPoint;
- (CGRect)rawViewportRectForContentRect:(CGRect)contentRect;
- (void)syncCustomCoreFromScrollView;
- (void)syncScrollViewFromCustomCore;
- (void)updateViewportModeViews;
- (void)preserveCustomViewportContentPoint:(CGPoint)contentPoint atViewPoint:(CGPoint)viewPoint reason:(NSString *)reason;
- (void)invalidateCustomViewportSurfaces;
- (void)clampCustomViewportSnap:(BOOL)snap;
- (void)clampCustomViewportSnap:(BOOL)snap preservingContentPoint:(CGPoint)contentPoint atViewPoint:(CGPoint)viewPoint;
- (void)applyCustomViewportDidChangeWithDeltaY:(CGFloat)deltaY force:(BOOL)force;
- (CGRect)viewportRectForContentRect:(CGRect)contentRect;
- (CGRect)contentRectForViewportRect:(CGRect)viewportRect;
- (void)setLiveInkNeedsDisplayInContentRect:(CGRect)contentRect;
- (void)setEditOverlayNeedsDisplaySafely;
- (void)setEditOverlayNeedsDisplayInRectSafely:(CGRect)rect;
- (void)setEditOverlayNeedsDisplayForRectChangeFrom:(CGRect)oldRect to:(CGRect)newRect;
- (void)flushDeferredEditOverlayInvalidation;
- (void)emitPageChangedIfNeededFromSource:(NSString *)source;
- (void)emitPageChangedDebounced;
- (void)handleViewportPan:(UIPanGestureRecognizer *)gesture;
- (void)handleViewportPinch:(UIPinchGestureRecognizer *)gesture;
- (void)handleSelectionPan:(UIPanGestureRecognizer *)gesture;
- (void)handleSelectionTap:(UITapGestureRecognizer *)gesture;
- (void)handleTextAnnotationMovePan:(UIPanGestureRecognizer *)gesture;
- (void)handleTextAnnotationResizePan:(UIPanGestureRecognizer *)gesture;
- (void)handleTextAnnotationTap:(UITapGestureRecognizer *)gesture;
- (void)handleTextDoneButton:(id)sender;
- (void)handleTextMinusButton:(id)sender;
- (void)handleTextPlusButton:(id)sender;
- (void)handleTextDeleteButton:(id)sender;
- (void)activateTextAnnotationView:(BsnPdfTextAnnotationView *)host focus:(BOOL)focus;
- (void)finishEditingTextAnnotationView:(BsnPdfTextAnnotationView *)host;
- (void)deactivateActiveTextAnnotationCommit:(BOOL)commit;
- (void)resizeTextAnnotationViewToFitContent:(BsnPdfTextAnnotationView *)host;
- (void)changeTextAnnotationFontForView:(BsnPdfTextAnnotationView *)host delta:(NSInteger)delta;
- (void)removeTextAnnotationView:(BsnPdfTextAnnotationView *)host;
- (void)updateTextAnnotationViews;
- (nullable BsnPdfPageLayout *)layoutForTextAnnotation:(NSDictionary *)annotation;
- (CGRect)frameForTextAnnotation:(NSDictionary *)annotation layout:(BsnPdfPageLayout *)layout;
- (NSDictionary *)logicalTextFrameForHost:(BsnPdfTextAnnotationView *)host;
- (void)updatePageReferenceViews;
- (nullable BsnPdfPageLayout *)layoutForPageReference:(NSDictionary *)reference;
- (void)handlePageReferenceSticker:(id)sender;
- (void)handlePageReferenceClose:(id)sender;
- (void)handlePageReferenceAsk:(id)sender;
- (void)emitPageReferenceAction:(NSString *)action referenceId:(NSString *)referenceId;
- (nullable UIImage *)imageForPageReference:(NSDictionary *)reference;
- (void)startInertiaWithVelocity:(CGPoint)velocity;
- (void)stepInertia:(CADisplayLink *)displayLink;
- (void)stopInertia;
- (void)stopViewportMotionAndSettle;
- (BOOL)isViewportMotionActive;
- (BOOL)isViewportUserInteractionActive;
- (BOOL)isCustomViewportDrivingScroll;
- (void)flushDeferredViewportInvalidations;
- (void)clampViewportOffsetSnap:(BOOL)snap;
- (void)clampViewportOffsetSnap:(BOOL)snap preservingContentPoint:(CGPoint)contentPoint atViewPoint:(CGPoint)viewPoint;
- (void)handleInkPan:(UIPanGestureRecognizer *)gesture;
- (CGRect)dirtyRectForStroke:(NSDictionary *)stroke;
- (CGRect)dirtyRectForLiveStroke:(NSDictionary *)stroke;
- (CGRect)dirtyRectForStrokeChangesFrom:(NSArray<NSDictionary *> *)beforeStrokes to:(NSArray<NSDictionary *> *)afterStrokes;
- (BOOL)imageAnnotation:(NSDictionary *)annotation belongsToLayout:(BsnPdfPageLayout *)layout;
- (CGRect)rectForImageAnnotation:(NSDictionary *)annotation layout:(BsnPdfPageLayout *)layout;
- (CGRect)dirtyRectForImageAnnotation:(NSDictionary *)annotation;
- (CGRect)dirtyRectForImageAnnotationChangesFrom:(NSArray<NSDictionary *> *)beforeAnnotations to:(NSArray<NSDictionary *> *)afterAnnotations;
- (nullable UIImage *)imageForAnnotation:(NSDictionary *)annotation dirtyRect:(CGRect)dirtyRect;
- (nullable UIImage *)decodeImageFromUri:(NSString *)uri;
- (nullable UIImage *)decodeImageFromData:(NSData *)data;
- (nullable UIImage *)decodeImageFromURL:(NSURL *)url;
- (NSString *)imageCacheKeyForAnnotation:(NSDictionary *)annotation;
- (void)beginPartialEraseIfNeeded;
- (void)erasePartialAtPoint:(NSDictionary *)point inLayout:(BsnPdfPageLayout *)layout;
- (BOOL)shouldProcessEraserPoint:(NSDictionary *)point force:(BOOL)force;
- (CGRect)rawLogicalBoundsForStroke:(NSDictionary *)stroke;
- (CGRect)logicalBoundsForStroke:(NSDictionary *)stroke padding:(CGFloat)padding;
- (void)resetStrokeBoundsCache;
- (BOOL)removeInkStrokeLocallyWithId:(NSString *)strokeId;
- (void)endPartialEraseWithCommit:(BOOL)commit;
- (NSArray<NSDictionary *> *)splitStroke:(NSDictionary *)stroke byEraserAtPoint:(NSDictionary *)point radius:(CGFloat)radius;
- (BOOL)stroke:(NSDictionary *)stroke hitsPoint:(NSDictionary *)point radius:(CGFloat)radius;
- (CGFloat)distanceFromPoint:(NSDictionary *)left toPoint:(NSDictionary *)right;
- (CGFloat)distanceFromPoint:(NSDictionary *)point toSegmentStart:(NSDictionary *)start end:(NSDictionary *)end;
- (NSDictionary *)interpolatePointFrom:(NSDictionary *)start to:(NSDictionary *)end ratio:(CGFloat)ratio;
- (void)appendPoint:(NSDictionary *)point toChunk:(NSMutableArray<NSDictionary *> *)chunk;
- (BOOL)shouldKeepChunk:(NSArray<NSDictionary *> *)points forStroke:(NSDictionary *)stroke;
- (BOOL)selectionPreviewAppliesToLayout:(BsnPdfPageLayout *)layout;
- (BOOL)strokeIsInSelectionPreview:(NSDictionary *)stroke;
- (NSDictionary *)selectionPreviewStrokeFromStroke:(NSDictionary *)stroke;
- (CGRect)selectionPreviewDirtyRectWithOffsetX:(CGFloat)offsetX y:(CGFloat)offsetY;
- (void)drawSelectionOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (void)drawSelectionMenuForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context;
- (void)drawMenuSymbol:(NSString *)symbolName inRect:(CGRect)rect color:(UIColor *)color;
- (BOOL)selectionOverlayAppliesToLayout:(BsnPdfPageLayout *)layout;
- (CGRect)selectionOverlayRectForLayout:(BsnPdfPageLayout *)layout;
- (CGRect)selectionMenuRectForLayout:(BsnPdfPageLayout *)layout;
- (NSArray<NSString *> *)selectionMenuSymbols;
- (nullable NSDictionary *)selectionMenuActionAtViewPoint:(CGPoint)viewPoint;
- (void)setSelectionOverlayNeedsDisplay;
- (void)logPerfMetricsIfNeededWithReason:(NSString *)reason;
- (void)logRenderDebugEvent:(NSString *)event target:(NSString *)target action:(NSString *)action rect:(CGRect)rect extra:(NSString *)extra;
- (void)logScrollDebugWithSource:(NSString *)source deltaY:(CGFloat)deltaY force:(BOOL)force;
- (void)emitSelectionGesture:(UIPanGestureRecognizer *)gesture phase:(NSString *)phase;
- (NSString *)selectionActionForPoint:(NSDictionary *)point resizeCorner:(NSString * __autoreleasing *)resizeCorner;
@end

@implementation BsnPdfCustomCoreView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.backgroundColor = [UIColor colorWithRed:0.95 green:0.96 blue:0.98 alpha:1.0];
    self.opaque = YES;
    self.userInteractionEnabled = NO;
    self.contentMode = UIViewContentModeRedraw;
  }
  return self;
}

- (void)drawRect:(CGRect)rect
{
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (self.owner == nil || context == nil) return;
  [self.owner drawCustomCoreInContext:context dirtyRect:rect];
}

@end

@implementation BsnPdfTiledLayer

+ (CFTimeInterval)fadeDuration
{
  return 0;
}

@end

@implementation BsnPdfContentView

+ (Class)layerClass
{
  return BsnPdfTiledLayer.class;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    CATiledLayer *tiledLayer = (CATiledLayer *)self.layer;
    tiledLayer.tileSize = CGSizeMake(512.0, 512.0);
    tiledLayer.levelsOfDetail = 1;
    tiledLayer.levelsOfDetailBias = 2;
    self.contentMode = UIViewContentModeRedraw;
  }
  return self;
}

- (void)drawRect:(CGRect)rect
{
  BsnPdfViewportView *owner = self.owner;
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (owner == nil || context == nil) return;

  [owner drawDocumentPagesInContext:context dirtyRect:rect drawEditing:NO];
}

@end

@implementation BsnPdfEditOverlayView

+ (Class)layerClass
{
  return CALayer.class;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.backgroundColor = UIColor.clearColor;
    self.opaque = NO;
    self.userInteractionEnabled = NO;
    self.contentMode = UIViewContentModeRedraw;
    self.clearsContextBeforeDrawing = NO;
  }
  return self;
}

- (void)drawRect:(CGRect)rect
{
  BsnPdfViewportView *owner = self.owner;
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (owner == nil || context == nil || owner.layouts.count == 0) return;

  for (BsnPdfPageLayout *layout in owner.layouts) {
    if (!CGRectIntersectsRect(rect, layout.frame)) continue;
    [owner drawImageAnnotationsForLayout:layout inContext:context];
    [owner drawInkForLayout:layout inContext:context];
    [owner drawSelectionOverlayForLayout:layout inContext:context];
    [owner drawSelectionMenuForLayout:layout inContext:context];
  }
}

@end

@implementation BsnPdfLiveInkView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.backgroundColor = UIColor.clearColor;
    self.opaque = NO;
    self.userInteractionEnabled = NO;
    self.contentMode = UIViewContentModeRedraw;
  }
  return self;
}

- (void)drawRect:(CGRect)rect
{
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (self.owner == nil || context == nil) return;
  CGFloat zoom = MAX(0.0001, [self.owner viewportScale]);
  CGPoint offset = [self.owner viewportContentOffset];
  CGRect contentDirtyRect = [self.owner contentRectForViewportRect:rect];
  CGContextSaveGState(context);
  CGContextTranslateCTM(context, -offset.x, -offset.y);
  CGContextScaleCTM(context, zoom, zoom);
  [self.owner drawLiveInkInContext:context dirtyRect:contentDirtyRect];
  CGContextRestoreGState(context);
}

@end

@implementation BsnPdfInkInputView

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  UITouch *touch = touches.anyObject;
  if (touch == nil) return;
  [self.owner interruptViewportMotionForUserTouch];
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

@implementation BsnPdfTextAnnotationView

- (instancetype)initWithOwner:(BsnPdfViewportView *)owner annotationId:(NSString *)annotationId
{
  if ((self = [super initWithFrame:CGRectZero])) {
    _owner = owner;
    _annotationId = [annotationId copy];
    self.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.92];
    self.layer.borderWidth = 1.0;
    self.layer.borderColor = [UIColor colorWithRed:0.49 green:0.62 blue:0.95 alpha:0.55].CGColor;
    self.layer.cornerRadius = 5.0;
    self.clipsToBounds = NO;

    _textView = [[UITextView alloc] initWithFrame:CGRectZero];
    _textView.backgroundColor = UIColor.clearColor;
    _textView.textContainerInset = UIEdgeInsetsMake(6, 7, 6, 7);
    _textView.textContainer.lineFragmentPadding = 0;
    _textView.scrollEnabled = NO;
    _textView.bounces = NO;
    _textView.autocorrectionType = UITextAutocorrectionTypeDefault;
    _textView.autocapitalizationType = UITextAutocapitalizationTypeSentences;
    _textView.returnKeyType = UIReturnKeyDefault;
    _textView.delegate = owner;
    [self addSubview:_textView];

    _toolbarView = [[UIView alloc] initWithFrame:CGRectZero];
    _toolbarView.backgroundColor = [UIColor colorWithRed:0.11 green:0.12 blue:0.14 alpha:0.96];
    _toolbarView.layer.cornerRadius = 16.0;
    _toolbarView.hidden = YES;
    [self addSubview:_toolbarView];

    _doneButton = [self makeButton:@"✓"];
    _minusButton = [self makeButton:@"−"];
    _plusButton = [self makeButton:@"+"];
    _deleteButton = [self makeButton:@"⌫"];
    [_doneButton addTarget:owner action:@selector(handleTextDoneButton:) forControlEvents:UIControlEventTouchUpInside];
    [_minusButton addTarget:owner action:@selector(handleTextMinusButton:) forControlEvents:UIControlEventTouchUpInside];
    [_plusButton addTarget:owner action:@selector(handleTextPlusButton:) forControlEvents:UIControlEventTouchUpInside];
    [_deleteButton addTarget:owner action:@selector(handleTextDeleteButton:) forControlEvents:UIControlEventTouchUpInside];
    [_toolbarView addSubview:_doneButton];
    [_toolbarView addSubview:_minusButton];
    [_toolbarView addSubview:_plusButton];
    [_toolbarView addSubview:_deleteButton];

    _resizeHandle = [[UIView alloc] initWithFrame:CGRectZero];
    _resizeHandle.backgroundColor = [UIColor colorWithRed:0.36 green:0.47 blue:1.0 alpha:0.95];
    _resizeHandle.layer.cornerRadius = 7.0;
    _resizeHandle.hidden = YES;
    [self addSubview:_resizeHandle];

    UIPanGestureRecognizer *movePan = [[UIPanGestureRecognizer alloc] initWithTarget:owner action:@selector(handleTextAnnotationMovePan:)];
    movePan.maximumNumberOfTouches = 1;
    [self addGestureRecognizer:movePan];

    UIPanGestureRecognizer *resizePan = [[UIPanGestureRecognizer alloc] initWithTarget:owner action:@selector(handleTextAnnotationResizePan:)];
    resizePan.maximumNumberOfTouches = 1;
    [_resizeHandle addGestureRecognizer:resizePan];

    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:owner action:@selector(handleTextAnnotationTap:)];
    [self addGestureRecognizer:tap];
    [self configureAccessory];
  }
  return self;
}

- (UIButton *)makeButton:(NSString *)title
{
  UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
  [button setTitle:title forState:UIControlStateNormal];
  [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
  button.titleLabel.font = [UIFont systemFontOfSize:17 weight:UIFontWeightBold];
  button.layer.cornerRadius = 14.0;
  button.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.10];
  return button;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  self.textView.frame = self.bounds;
  CGFloat toolbarWidth = 156.0;
  CGFloat toolbarHeight = 38.0;
  CGFloat toolbarX = MAX(-self.frame.origin.x + 8.0, MIN((self.bounds.size.width - toolbarWidth) * 0.5, self.bounds.size.width - toolbarWidth));
  CGFloat toolbarY = self.frame.origin.y > 52.0 ? -44.0 : self.bounds.size.height + 8.0;
  self.toolbarView.frame = CGRectMake(toolbarX, toolbarY, toolbarWidth, toolbarHeight);
  CGFloat button = 30.0;
  CGFloat gap = 6.0;
  NSArray<UIButton *> *buttons = @[self.doneButton, self.minusButton, self.plusButton, self.deleteButton];
  CGFloat x = 8.0;
  for (UIButton *item in buttons) {
    item.frame = CGRectMake(x, 4.0, button, button);
    x += button + gap;
  }
  self.resizeHandle.frame = CGRectMake(self.bounds.size.width - 13.0, self.bounds.size.height - 13.0, 16.0, 16.0);
}

- (void)setActive:(BOOL)active
{
  _active = active;
  self.toolbarView.hidden = YES;
  self.resizeHandle.hidden = !active;
  self.layer.borderColor = (active
    ? [UIColor colorWithRed:0.32 green:0.45 blue:1.0 alpha:0.95]
    : [UIColor colorWithRed:0.49 green:0.62 blue:0.95 alpha:0.42]).CGColor;
  self.layer.borderWidth = active ? 1.6 : 1.0;
  [self setNeedsLayout];
}

- (void)configureAccessory
{
  UIToolbar *toolbar = [[UIToolbar alloc] initWithFrame:CGRectMake(0, 0, UIScreen.mainScreen.bounds.size.width, 44)];
  UIBarButtonItem *minus = [[UIBarButtonItem alloc] initWithTitle:@"−" style:UIBarButtonItemStylePlain target:self.owner action:@selector(handleTextMinusButton:)];
  UIBarButtonItem *plus = [[UIBarButtonItem alloc] initWithTitle:@"+" style:UIBarButtonItemStylePlain target:self.owner action:@selector(handleTextPlusButton:)];
  UIBarButtonItem *delete = [[UIBarButtonItem alloc] initWithTitle:@"삭제" style:UIBarButtonItemStylePlain target:self.owner action:@selector(handleTextDeleteButton:)];
  UIBarButtonItem *flex = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemFlexibleSpace target:nil action:nil];
  UIBarButtonItem *done = [[UIBarButtonItem alloc] initWithTitle:@"완료" style:UIBarButtonItemStyleDone target:self.owner action:@selector(handleTextDoneButton:)];
  toolbar.items = @[minus, plus, delete, flex, done];
  self.textView.inputAccessoryView = toolbar;
}

@end

@implementation BsnPdfPageReferenceView

- (instancetype)initWithOwner:(BsnPdfViewportView *)owner referenceId:(NSString *)referenceId
{
  if ((self = [super initWithFrame:CGRectZero])) {
    _owner = owner;
    _referenceId = [referenceId copy];
    self.backgroundColor = UIColor.clearColor;
    self.clipsToBounds = NO;

    _stickerButton = [UIButton buttonWithType:UIButtonTypeSystem];
    _stickerButton.backgroundColor = [UIColor colorWithRed:0.93 green:0.95 blue:1.0 alpha:0.96];
    _stickerButton.layer.borderWidth = 1.0;
    _stickerButton.layer.borderColor = [UIColor colorWithRed:0.79 green:0.84 blue:1.0 alpha:1.0].CGColor;
    _stickerButton.layer.cornerRadius = 16.0;
    _stickerButton.titleLabel.font = [UIFont systemFontOfSize:11 weight:UIFontWeightHeavy];
    [_stickerButton setTitleColor:[UIColor colorWithRed:0.31 green:0.41 blue:0.82 alpha:1.0] forState:UIControlStateNormal];
    [_stickerButton addTarget:owner action:@selector(handlePageReferenceSticker:) forControlEvents:UIControlEventTouchUpInside];
    [self addSubview:_stickerButton];

    _popoverView = [[UIView alloc] initWithFrame:CGRectZero];
    _popoverView.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.98];
    _popoverView.layer.cornerRadius = 16.0;
    _popoverView.layer.borderWidth = 1.0;
    _popoverView.layer.borderColor = [UIColor colorWithRed:0.86 green:0.90 blue:0.96 alpha:1.0].CGColor;
    _popoverView.layer.shadowColor = [UIColor colorWithRed:0.29 green:0.35 blue:0.45 alpha:1.0].CGColor;
    _popoverView.layer.shadowOpacity = 0.16;
    _popoverView.layer.shadowRadius = 16.0;
    _popoverView.layer.shadowOffset = CGSizeMake(0, 8);
    _popoverView.clipsToBounds = NO;
    [self addSubview:_popoverView];

    _pageLabel = [self makeLabelWithSize:10 weight:UIFontWeightHeavy color:[UIColor colorWithRed:0.42 green:0.48 blue:0.60 alpha:1.0]];
    _titleLabel = [self makeLabelWithSize:13 weight:UIFontWeightHeavy color:[UIColor colorWithRed:0.15 green:0.19 blue:0.27 alpha:1.0]];
    _summaryLabel = [self makeLabelWithSize:11 weight:UIFontWeightSemibold color:[UIColor colorWithRed:0.36 green:0.41 blue:0.49 alpha:1.0]];
    _summaryLabel.numberOfLines = 4;

    _imageView = [[UIImageView alloc] initWithFrame:CGRectZero];
    _imageView.backgroundColor = [UIColor colorWithRed:0.97 green:0.98 blue:0.99 alpha:1.0];
    _imageView.contentMode = UIViewContentModeScaleAspectFit;
    _imageView.clipsToBounds = YES;
    _imageView.layer.cornerRadius = 12.0;
    _imageView.layer.borderWidth = 1.0;
    _imageView.layer.borderColor = [UIColor colorWithRed:0.91 green:0.93 blue:0.96 alpha:1.0].CGColor;

    _closeButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [_closeButton setTitle:@"x" forState:UIControlStateNormal];
    [_closeButton setTitleColor:[UIColor colorWithRed:0.42 green:0.45 blue:0.50 alpha:1.0] forState:UIControlStateNormal];
    _closeButton.titleLabel.font = [UIFont systemFontOfSize:14 weight:UIFontWeightHeavy];
    _closeButton.backgroundColor = [UIColor colorWithRed:0.96 green:0.97 blue:0.99 alpha:1.0];
    _closeButton.layer.cornerRadius = 14.0;
    [_closeButton addTarget:owner action:@selector(handlePageReferenceClose:) forControlEvents:UIControlEventTouchUpInside];

    _askButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [_askButton setTitle:@"Ask AI" forState:UIControlStateNormal];
    [_askButton setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    _askButton.titleLabel.font = [UIFont systemFontOfSize:12 weight:UIFontWeightHeavy];
    _askButton.backgroundColor = [UIColor colorWithRed:0.37 green:0.47 blue:1.0 alpha:1.0];
    _askButton.layer.cornerRadius = 12.0;
    [_askButton addTarget:owner action:@selector(handlePageReferenceAsk:) forControlEvents:UIControlEventTouchUpInside];

    [_popoverView addSubview:_pageLabel];
    [_popoverView addSubview:_titleLabel];
    [_popoverView addSubview:_closeButton];
    [_popoverView addSubview:_imageView];
    [_popoverView addSubview:_summaryLabel];
    [_popoverView addSubview:_askButton];
  }
  return self;
}

- (UILabel *)makeLabelWithSize:(CGFloat)size weight:(UIFontWeight)weight color:(UIColor *)color
{
  UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
  label.font = [UIFont systemFontOfSize:size weight:weight];
  label.textColor = color;
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  return label;
}

- (void)configureWithReference:(NSDictionary *)reference image:(nullable UIImage *)image count:(NSInteger)count open:(BOOL)open
{
  self.open = open;
  NSString *type = [RCTConvert NSString:reference[@"type"]] ?: @"image";
  NSString *buttonTitle = [type isEqualToString:@"image"]
    ? (count > 1 ? [NSString stringWithFormat:@"Photo %ld", (long)count] : @"Photo")
    : (count > 1 ? [NSString stringWithFormat:@"Ref %ld", (long)count] : @"Ref");
  [self.stickerButton setTitle:buttonTitle forState:UIControlStateNormal];
  self.pageLabel.text = [RCTConvert NSString:reference[@"pageLabel"]] ?: @"Page";
  self.titleLabel.text = [RCTConvert NSString:reference[@"title"]] ?: buttonTitle;
  NSString *summary = [RCTConvert NSString:reference[@"aiSummary"]] ?: [RCTConvert NSString:reference[@"summary"]] ?: @"";
  self.summaryLabel.text = summary.length > 0 ? summary : @"No summary";
  self.imageView.image = image;
  self.imageView.hidden = image == nil;
  self.popoverView.hidden = !open;
  self.stickerButton.backgroundColor = open ? UIColor.whiteColor : [UIColor colorWithRed:0.93 green:0.95 blue:1.0 alpha:0.96];
  [self setNeedsLayout];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  CGFloat stickerWidth = 86.0;
  self.stickerButton.frame = CGRectMake(MAX(0, self.bounds.size.width - stickerWidth), 0, stickerWidth, 32.0);
  if (!self.open) return;

  CGFloat popoverY = 42.0;
  CGFloat popoverHeight = MAX(160.0, self.bounds.size.height - popoverY);
  self.popoverView.frame = CGRectMake(0, popoverY, self.bounds.size.width, popoverHeight);

  CGFloat inset = 12.0;
  self.pageLabel.frame = CGRectMake(inset, 9.0, self.bounds.size.width - 64.0, 14.0);
  self.titleLabel.frame = CGRectMake(inset, 24.0, self.bounds.size.width - 64.0, 20.0);
  self.closeButton.frame = CGRectMake(self.bounds.size.width - 42.0, 12.0, 28.0, 28.0);

  CGFloat imageY = 56.0;
  CGFloat actionHeight = 34.0;
  CGFloat summaryHeight = 62.0;
  CGFloat imageHeight = MAX(0.0, popoverHeight - imageY - summaryHeight - actionHeight - 34.0);
  self.imageView.frame = CGRectMake(inset, imageY, self.bounds.size.width - inset * 2.0, imageHeight);
  CGFloat summaryY = imageY + (self.imageView.hidden ? 0.0 : imageHeight + 10.0);
  self.summaryLabel.frame = CGRectMake(inset, summaryY, self.bounds.size.width - inset * 2.0, summaryHeight);
  self.askButton.frame = CGRectMake(inset, popoverHeight - actionHeight - 12.0, self.bounds.size.width - inset * 2.0, actionHeight);
}

@end

@implementation BsnPdfNativeInkGestureRecognizer

- (BOOL)shouldTrackTouch:(UITouch *)touch
{
  if (touch == nil || self.owner == nil) return NO;
  if (![self.owner shouldAcceptTouch:touch]) return NO;
  if (@available(iOS 9.1, *)) {
    if (touch.type == UITouchTypePencil) return self.acceptsPencil;
    return self.acceptsFinger;
  }
  return self.acceptsFinger || self.acceptsPencil;
}

- (void)beginWithTouch:(UITouch *)touch
{
  [self.owner beginInkAtPoint:[touch preciseLocationInView:self.owner]];
}

- (void)moveWithTouchSamples:(NSArray<UITouch *> *)samples predicted:(BOOL)predicted
{
  for (UITouch *sample in samples) {
    [self.owner moveInkAtPoint:[sample preciseLocationInView:self.owner] predicted:predicted];
  }
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  if (self.activeTouch != nil || touches.count != 1) {
    self.state = UIGestureRecognizerStateFailed;
    return;
  }
  UITouch *touch = touches.anyObject;
  if (![self shouldTrackTouch:touch]) {
    self.state = UIGestureRecognizerStateFailed;
    return;
  }
  self.activeTouch = touch;
  [self beginWithTouch:touch];
  self.state = UIGestureRecognizerStateBegan;
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  UITouch *touch = self.activeTouch;
  if (touch == nil || ![touches containsObject:touch]) return;
  NSArray<UITouch *> *samples = [event coalescedTouchesForTouch:touch] ?: @[touch];
  [self moveWithTouchSamples:samples predicted:NO];
  NSArray<UITouch *> *predictedSamples = [event predictedTouchesForTouch:touch];
  if (predictedSamples.count > 0) {
    [self moveWithTouchSamples:predictedSamples predicted:YES];
  }
  self.state = UIGestureRecognizerStateChanged;
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  UITouch *touch = self.activeTouch;
  if (touch != nil && [touches containsObject:touch]) {
    NSArray<UITouch *> *samples = [event coalescedTouchesForTouch:touch] ?: @[touch];
    [self moveWithTouchSamples:samples predicted:NO];
  }
  [self.owner endInkWithCommit:YES];
  self.state = UIGestureRecognizerStateEnded;
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [self.owner endInkWithCommit:NO];
  self.state = UIGestureRecognizerStateCancelled;
}

- (void)reset
{
  [super reset];
  self.activeTouch = nil;
}

@end

@implementation BsnPdfViewportView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _requestedPage = 1;
    _requestedPageSerial = 0;
    _appliedRequestedPageSerial = 0;
    _inkTool = @"view";
    _penColor = @"#111827";
    _penWidth = 3.0;
    _brushType = @"pen";
    _linePattern = @"solid";
    _eraserMode = @"partial";
    _eraserWidth = 16.0;
    _notebookPages = @[];
    _inkStrokes = @[];
    _textAnnotations = @[];
    _imageAnnotations = @[];
    _pageCaptureReferences = @[];
    _openPageCaptureReferenceId = nil;
    _hiddenTextAnnotationIds = @[];
    _hiddenTextAnnotationIdSet = [NSSet set];
    _textAnnotationViews = [NSMutableDictionary dictionary];
    _textAnnotationById = [NSMutableDictionary dictionary];
    _pageReferenceViews = [NSMutableDictionary dictionary];
    _imageAnnotationCache = [NSMutableDictionary dictionary];
    _imageAnnotationLoadsInFlight = [NSMutableSet set];
    _selectionPreviewStrokeIds = @[];
    _selectionPreviewStrokeIdSet = [NSSet set];
    _selectionPreviewPageNumber = 0;
    _selectionPreviewGeneratedPageId = nil;
    _selectionPreviewOffsetX = 0;
    _selectionPreviewOffsetY = 0;
    _selectionOverlayPageNumber = 0;
    _selectionOverlayGeneratedPageId = nil;
    _selectionOverlayX = 0;
    _selectionOverlayY = 0;
    _selectionOverlayWidth = 0;
    _selectionOverlayHeight = 0;
    _selectionOverlayPageWidth = 1;
    _selectionOverlayPageHeight = 1;
    _selectionOverlayDraft = NO;
    _selectionGestureEnabled = NO;
    _selectionMode = @"rect";
    _selectionOverlayMode = @"rect";
    _selectionOverlayPath = @[];
    _selectionMenuEnabled = NO;
    _selectionMenuEditable = NO;
    _textGestureEnabled = NO;
    _customViewportCoreEnabled = NO;
    _selectionColorPickerOpen = NO;
    _perfLoggingEnabled = NO;
    _renderDebugLoggingEnabled = NO;
    _lastPerfLogTime = 0;
    _lastScrollDebugLogTime = 0;
    _renderDebugLastLogTimes = [NSMutableDictionary dictionary];
    _baseCacheHits = 0;
    _baseCacheMisses = 0;
    _baseRenderCompletedCount = 0;
    _hiResRenderCompletedCount = 0;
    _layouts = @[];
    _pendingScrollToRequestedPage = YES;
    _hasAppliedInitialPage = NO;
    _viewportEventScheduled = NO;
    _inkInteractionActive = NO;
    _lastPageNumber = 0;
    _reportedPageNumber = 0;
    _renderGeneration = 0;
    _hiResGeneration = 0;
    _baseRenderDirection = 0;
    _coreScale = BsnPdfMinZoom;
    _coreScrollYDocument = 0;
    _coreTranslateX = 0;
    _coreContentHeight = 1;
    _coreContentWidth = 1;
    _syncingCustomViewportToScrollView = NO;
    _pinchStartZoom = 1.0;
    _pinchFocusContentPoint = CGPointZero;
    _pinchFocusAnchor = nil;
    _pinchLastFocusViewPoint = CGPointZero;
    _viewportPinchActive = NO;
    _viewportPanActive = NO;
    _inertiaVelocity = CGPointZero;
    _inertiaLastTimestamp = 0;
    _lastViewportSize = CGSizeZero;
    _pendingDeferredLayoutSize = CGSizeZero;
    _pendingCustomLayoutAnchor = nil;
    _pendingCustomLayoutViewPoint = CGPointZero;
    _pendingCustomLayoutReason = nil;
    _deferredWidthLayoutPending = NO;
    _suppressAnchorSaveUntil = 0;
    _suppressInkViewportEventsUntil = 0;
    _suppressScrollPageEventsUntil = 0;
    _protectedPageNumber = 0;
    _restoringViewportAnchor = NO;
    _lastBaseRenderScheduleKey = @"";
    _lastViewportEventKey = @"";
    _pendingCommittedStrokes = [NSMutableArray array];
    _pendingRemovedStrokeIds = [NSMutableSet set];
    _strokeBoundsCache = [NSMutableDictionary dictionary];
    _deferredCommitStrokes = [NSMutableArray array];
    _deferredCommitScheduled = NO;
    _deferredContentInvalidation = NO;
    _deferredContentInvalidationRect = CGRectNull;
    _deferredEditOverlayInvalidation = NO;
    _deferredEditOverlayInvalidationRect = CGRectNull;
    _pendingPageChangeSource = @"init";
    _lastActiveStrokeDirtyRect = CGRectNull;
    _retainedLiveStrokeDirtyRect = CGRectNull;

    _scrollView = [[UIScrollView alloc] initWithFrame:self.bounds];
    _scrollView.delegate = self;
    _scrollView.minimumZoomScale = BsnPdfMinZoom;
    _scrollView.maximumZoomScale = BsnPdfMaxZoom;
    _scrollView.bouncesZoom = NO;
    _scrollView.alwaysBounceVertical = YES;
    _scrollView.showsHorizontalScrollIndicator = NO;
    _scrollView.showsVerticalScrollIndicator = YES;
    _scrollView.backgroundColor = [UIColor colorWithRed:0.95 green:0.96 blue:0.98 alpha:1.0];
    [self addSubview:_scrollView];

    _contentView = [[BsnPdfContentView alloc] initWithFrame:CGRectZero];
    _contentView.owner = self;
    _contentView.backgroundColor = _scrollView.backgroundColor;
    [_scrollView addSubview:_contentView];

    _editOverlayView = [[BsnPdfEditOverlayView alloc] initWithFrame:CGRectZero];
    _editOverlayView.owner = self;
    _editOverlayView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [_contentView addSubview:_editOverlayView];

    _customCoreView = [[BsnPdfCustomCoreView alloc] initWithFrame:self.bounds];
    _customCoreView.owner = self;
    _customCoreView.hidden = YES;
    [self addSubview:_customCoreView];

    _customNativeSubviewLayer = [[UIView alloc] initWithFrame:self.bounds];
    _customNativeSubviewLayer.backgroundColor = UIColor.clearColor;
    _customNativeSubviewLayer.opaque = NO;
    _customNativeSubviewLayer.hidden = YES;
    [self addSubview:_customNativeSubviewLayer];

    _liveInkView = [[BsnPdfLiveInkView alloc] initWithFrame:CGRectZero];
    _liveInkView.owner = self;
    _liveInkView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self addSubview:_liveInkView];

    _inkInputView = [[BsnPdfInkInputView alloc] initWithFrame:self.bounds];
    _inkInputView.owner = self;
    _inkInputView.backgroundColor = UIColor.clearColor;
    [self addSubview:_inkInputView];

    _viewportPanGesture = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handleViewportPan:)];
    _viewportPanGesture.minimumNumberOfTouches = 1;
    _viewportPanGesture.maximumNumberOfTouches = 1;
    _viewportPanGesture.cancelsTouchesInView = YES;
    _viewportPanGesture.delegate = self;
    [self addGestureRecognizer:_viewportPanGesture];

    _viewportPinchGesture = [[UIPinchGestureRecognizer alloc] initWithTarget:self action:@selector(handleViewportPinch:)];
    _viewportPinchGesture.cancelsTouchesInView = YES;
    _viewportPinchGesture.delegate = self;
    [self addGestureRecognizer:_viewportPinchGesture];

    _selectionGesture = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handleSelectionPan:)];
    _selectionGesture.minimumNumberOfTouches = 1;
    _selectionGesture.maximumNumberOfTouches = 1;
    _selectionGesture.cancelsTouchesInView = YES;
    _selectionGesture.delegate = self;
    _selectionGesture.enabled = NO;
    [self addGestureRecognizer:_selectionGesture];

    _selectionTapGesture = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleSelectionTap:)];
    _selectionTapGesture.numberOfTapsRequired = 1;
    _selectionTapGesture.cancelsTouchesInView = YES;
    _selectionTapGesture.delegate = self;
    _selectionTapGesture.enabled = NO;
    [self addGestureRecognizer:_selectionTapGesture];

    _textTapGesture = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleTextTap:)];
    _textTapGesture.numberOfTapsRequired = 1;
    _textTapGesture.cancelsTouchesInView = YES;
    _textTapGesture.delegate = self;
    _textTapGesture.enabled = NO;
    [self addGestureRecognizer:_textTapGesture];

    _pencilInkPanGesture = [BsnPdfNativeInkGestureRecognizer new];
    _pencilInkPanGesture.owner = self;
    _pencilInkPanGesture.acceptsPencil = YES;
    _pencilInkPanGesture.acceptsFinger = NO;
    _pencilInkPanGesture.cancelsTouchesInView = YES;
    _pencilInkPanGesture.delegate = self;
    if (@available(iOS 9.1, *)) {
      _pencilInkPanGesture.allowedTouchTypes = @[@(UITouchTypePencil)];
    }
    [self addGestureRecognizer:_pencilInkPanGesture];

    _fingerInkPanGesture = [BsnPdfNativeInkGestureRecognizer new];
    _fingerInkPanGesture.owner = self;
    _fingerInkPanGesture.acceptsPencil = NO;
    _fingerInkPanGesture.acceptsFinger = YES;
    _fingerInkPanGesture.cancelsTouchesInView = YES;
    _fingerInkPanGesture.delegate = self;
    if (@available(iOS 9.1, *)) {
      _fingerInkPanGesture.allowedTouchTypes = @[@(UITouchTypeDirect)];
    }
    [self addGestureRecognizer:_fingerInkPanGesture];
    [_scrollView.panGestureRecognizer requireGestureRecognizerToFail:_pencilInkPanGesture];
    [_scrollView.panGestureRecognizer requireGestureRecognizerToFail:_fingerInkPanGesture];

    _baseBitmapCache = [NSCache new];
    _baseBitmapCache.totalCostLimit = 96 * 1024 * 1024;
    _baseBitmapCache.countLimit = 40;
    _latestBaseImageByPageNumber = [NSMutableDictionary dictionary];
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
  [self.inertiaDisplayLink invalidate];
  [self.baseRenderQueue cancelAllOperations];
  [self.hiResRenderQueue cancelAllOperations];
  [self.baseBitmapCache removeAllObjects];
  [self.hiResOverlays removeAllObjects];
  [self.hiResInFlight removeAllObjects];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window == nil) [self stopInertia];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  CGSize previousSize = self.lastViewportSize;
  CGSize nextSize = self.bounds.size;
  BOOL sizeChanged = fabs(nextSize.width - previousSize.width) > 0.5
    || fabs(nextSize.height - previousSize.height) > 0.5;
  BOOL shouldLockCustomResizeFocus = self.customViewportCoreEnabled
    && sizeChanged
    && self.layouts.count > 0
    && previousSize.width > 0
    && previousSize.height > 0
    && nextSize.width > 0
    && nextSize.height > 0;
  NSDictionary *customResizeAnchor = nil;
  if (shouldLockCustomResizeFocus) {
    customResizeAnchor = [self captureCustomViewportAnchorAtViewPoint:CGPointMake(previousSize.width * 0.5, previousSize.height * 0.5)];
  }
  if (sizeChanged && ![self isViewportUserInteractionActive]) {
    [self stopViewportMotionAndSettle];
    if (self.pendingLayoutTransitionAnchor == nil) {
      self.pendingLayoutTransitionAnchor = [self captureViewportAnchor];
    }
  }
  self.scrollView.frame = self.bounds;
  self.customCoreView.frame = self.bounds;
  self.customNativeSubviewLayer.frame = self.bounds;
  self.editOverlayView.frame = self.contentView.bounds;
  self.liveInkView.frame = self.bounds;
  self.inkInputView.frame = self.bounds;
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0) return;
  if (!sizeChanged) return;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] layoutSubviews sizeChanged old=%.1fx%.1f new=%.1fx%.1f page=%ld reported=%ld offsetY=%.1f",
    previousSize.width,
    previousSize.height,
    nextSize.width,
    nextSize.height,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    self.scrollView.contentOffset.y);
  self.lastViewportSize = nextSize;
  if (self.customViewportCoreEnabled) {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(performDeferredWidthLayoutRebuild) object:nil];
    self.deferredWidthLayoutPending = NO;
    self.pendingDeferredLayoutSize = CGSizeZero;
    self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.28;
    self.pendingCustomLayoutAnchor = customResizeAnchor;
    self.pendingCustomLayoutViewPoint = CGPointMake(nextSize.width * 0.5, nextSize.height * 0.5);
    self.pendingCustomLayoutReason = @"layout-resize-realtime";
    [self logRenderDebugEvent:@"layout" target:@"viewport" action:@"rebuild-resize-realtime" rect:self.bounds extra:@""];
    [self rebuildLayout];
    return;
  }
  if ([self shouldDeferWidthOnlyLayoutFromSize:previousSize toSize:nextSize]) {
    self.deferredWidthLayoutPending = YES;
    self.pendingDeferredLayoutSize = nextSize;
    self.suppressAnchorSaveUntil = MAX(self.suppressAnchorSaveUntil, CACurrentMediaTime() + BsnPdfDeferredWidthLayoutDelay + 0.12);
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(performDeferredWidthLayoutRebuild) object:nil];
    [self performSelector:@selector(performDeferredWidthLayoutRebuild) withObject:nil afterDelay:BsnPdfDeferredWidthLayoutDelay];
    [self logRenderDebugEvent:@"layout" target:@"viewport" action:@"defer-width-resize" rect:self.bounds extra:@""];
    [self requestViewportChangedForce:NO];
    return;
  }
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(performDeferredWidthLayoutRebuild) object:nil];
  self.deferredWidthLayoutPending = NO;
  self.pendingDeferredLayoutSize = CGSizeZero;
  self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.9;
  [self rebuildLayout];
}

- (BOOL)shouldDeferWidthOnlyLayoutFromSize:(CGSize)oldSize toSize:(CGSize)newSize
{
  if (self.document == nil || self.layouts.count == 0) return NO;
  if (oldSize.width <= 0 || oldSize.height <= 0 || newSize.width <= 0 || newSize.height <= 0) return NO;
  if (self.pendingScrollToRequestedPage) return NO;
  if ([self isViewportUserInteractionActive]) return NO;
  if (self.customViewportCoreEnabled) return NO;
  if (fabs(newSize.height - oldSize.height) > 0.5) return NO;
  return fabs(newSize.width - oldSize.width) > 0.5;
}

- (void)performDeferredWidthLayoutRebuild
{
  if (!self.deferredWidthLayoutPending) return;
  self.deferredWidthLayoutPending = NO;
  self.pendingDeferredLayoutSize = CGSizeZero;
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0) return;
  self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.9;
  [self logRenderDebugEvent:@"layout" target:@"viewport" action:@"deferred-width-rebuild" rect:self.bounds extra:@""];
  [self rebuildLayout];
}

- (void)setFileUri:(NSString *)fileUri
{
  if ((_fileUri == fileUri) || [_fileUri isEqualToString:fileUri]) return;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] setFileUri changed old=%@ new=%@", _fileUri ?: @"", fileUri ?: @"");
  _fileUri = [fileUri copy];
  [self openDocument];
}

- (void)setCustomViewportCoreEnabled:(BOOL)customViewportCoreEnabled
{
  if (_customViewportCoreEnabled == customViewportCoreEnabled) return;
  if (customViewportCoreEnabled) {
    [self syncCustomCoreFromScrollView];
  } else if (_customViewportCoreEnabled) {
    [self syncScrollViewFromCustomCore];
  }
  _customViewportCoreEnabled = customViewportCoreEnabled;
  [self updateViewportModeViews];
}

- (void)setRequestedPage:(NSInteger)requestedPage
{
  NSInteger nextPage = MAX(1, requestedPage);
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] setRequestedPage incoming=%ld normalized=%ld currentRequested=%ld serial=%ld appliedSerial=%ld last=%ld reported=%ld pending=%@ offsetY=%.1f",
    (long)requestedPage,
    (long)nextPage,
    (long)_requestedPage,
    (long)self.requestedPageSerial,
    (long)self.appliedRequestedPageSerial,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    self.pendingScrollToRequestedPage ? @"YES" : @"NO",
    self.scrollView.contentOffset.y);
  BOOL nonExplicitPinchSync = self.viewportPinchActive
    && self.hasAppliedInitialPage
    && self.lastPageNumber > 0
    && nextPage != self.lastPageNumber
    && self.requestedPageSerial <= self.appliedRequestedPageSerial;
  if (nonExplicitPinchSync) {
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore setRequestedPage pinch-sync incoming=%ld stable=%ld reported=%ld offsetY=%.1f",
      (long)nextPage,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      self.scrollView.contentOffset.y);
    _requestedPage = self.lastPageNumber;
    self.pendingScrollToRequestedPage = NO;
    return;
  }
  BOOL propSyncDuringProtectedScroll = self.hasAppliedInitialPage
    && self.requestedPageSerial <= self.appliedRequestedPageSerial
    && CACurrentMediaTime() < self.suppressScrollPageEventsUntil
    && self.protectedPageNumber > 1
    && nextPage != self.protectedPageNumber
    && ![self isViewportUserInteractionActive];
  if (propSyncDuringProtectedScroll) {
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore setRequestedPage protected-scroll incoming=%ld protected=%ld last=%ld reported=%ld offsetY=%.1f",
      (long)nextPage,
      (long)self.protectedPageNumber,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      self.scrollView.contentOffset.y);
    _requestedPage = self.protectedPageNumber;
    self.pendingScrollToRequestedPage = NO;
    return;
  }
  BOOL changed = _requestedPage != nextPage;
  _requestedPage = nextPage;
  if (!changed && self.requestedPageSerial <= self.appliedRequestedPageSerial) return;
  [self applyRequestedPageIfNeeded];
}

- (void)setRequestedPageSerial:(NSInteger)requestedPageSerial
{
  if (_requestedPageSerial == requestedPageSerial) return;
  _requestedPageSerial = requestedPageSerial;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] setRequestedPageSerial serial=%ld requested=%ld appliedSerial=%ld last=%ld reported=%ld offsetY=%.1f",
    (long)requestedPageSerial,
    (long)self.requestedPage,
    (long)self.appliedRequestedPageSerial,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    self.scrollView.contentOffset.y);
  [self applyRequestedPageIfNeeded];
}

- (void)applyRequestedPageIfNeeded
{
  NSInteger nextPage = MAX(1, self.requestedPage);
  BOOL explicitRequest = self.requestedPageSerial > self.appliedRequestedPageSerial;
  BOOL suppressingProgrammaticLayout = [self isSuppressingProgrammaticLayout];
  if (!explicitRequest && suppressingProgrammaticLayout && self.hasAppliedInitialPage && self.lastPageNumber > 0 && nextPage != self.lastPageNumber) {
    return;
  }
  NSInteger stablePage = [self stablePageForProgrammaticLayout];
  if (
    explicitRequest
    && self.hasAppliedInitialPage
    && suppressingProgrammaticLayout
    && nextPage == 1
    && stablePage > 1
    && ![self isViewportUserInteractionActive]
  ) {
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore explicit stale-one during anchor restore incoming=%ld stable=%ld last=%ld reported=%ld serial=%ld offsetY=%.1f",
      (long)nextPage,
      (long)stablePage,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      (long)self.requestedPageSerial,
      self.scrollView.contentOffset.y);
    _requestedPage = stablePage;
    self.pendingScrollToRequestedPage = NO;
    self.appliedRequestedPageSerial = self.requestedPageSerial;
    return;
  }
  if (
    !explicitRequest
    && self.hasAppliedInitialPage
    && self.reportedPageNumber > 0
  ) {
    return;
  }
  if (
    !explicitRequest
    && self.hasAppliedInitialPage
    && suppressingProgrammaticLayout
    && stablePage > 1
    && nextPage != stablePage
  ) {
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore setRequestedPage layout-stale incoming=%ld stable=%ld last=%ld reported=%ld offsetY=%.1f",
      (long)nextPage,
      (long)stablePage,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      self.scrollView.contentOffset.y);
    return;
  }
  if (
    !explicitRequest
    && self.hasAppliedInitialPage
    && nextPage == 1
    && stablePage > 1
    && (self.scrollView.contentOffset.y > MAX(160.0, self.bounds.size.height * 0.35) || [self savedAnchorPageNumber] > 1)
    && ![self isViewportUserInteractionActive]
  ) {
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore setRequestedPage stale-one incoming=%ld stable=%ld last=%ld reported=%ld offsetY=%.1f",
      (long)nextPage,
      (long)stablePage,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      self.scrollView.contentOffset.y);
    return;
  }
  if (_requestedPage == nextPage && nextPage == self.lastPageNumber) {
    if (explicitRequest) self.appliedRequestedPageSerial = self.requestedPageSerial;
    return;
  }
  _requestedPage = nextPage;
  if (nextPage == self.lastPageNumber) {
    if (explicitRequest) self.appliedRequestedPageSerial = self.requestedPageSerial;
    return;
  }
  _pendingScrollToRequestedPage = YES;
  [self scrollToRequestedPageIfNeeded];
}

- (void)setNotebookPages:(NSArray<NSDictionary *> *)notebookPages
{
  NSArray<NSDictionary *> *nextPages = [notebookPages isKindOfClass:NSArray.class] ? notebookPages : @[];
  if ([_notebookPages isEqualToArray:nextPages]) return;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] setNotebookPages rebuild old=%lu new=%lu last=%ld reported=%ld offsetY=%.1f",
    (unsigned long)_notebookPages.count,
    (unsigned long)nextPages.count,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    self.scrollView.contentOffset.y);
  _notebookPages = [nextPages copy];
  [self rebuildLayout];
}

- (void)setInkTool:(NSString *)inkTool
{
  NSString *nextTool = inkTool.length ? [inkTool copy] : @"view";
  if (![_inkTool isEqualToString:nextTool]) {
    if (![nextTool isEqualToString:@"text"]) {
      [self deactivateActiveTextAnnotationCommit:YES];
    }
  }
  _inkTool = nextTool;
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
- (void)setEraserMode:(NSString *)eraserMode { _eraserMode = [eraserMode isEqualToString:@"stroke"] ? @"stroke" : @"partial"; }
- (void)setEraserWidth:(CGFloat)eraserWidth { _eraserWidth = MIN(48.0, MAX(8.0, eraserWidth)); }

- (void)setSelectionPreviewStrokeIds:(NSArray<NSString *> *)selectionPreviewStrokeIds
{
  NSArray *ids = [selectionPreviewStrokeIds isKindOfClass:NSArray.class] ? selectionPreviewStrokeIds : @[];
  NSSet *nextSet = [NSSet setWithArray:ids];
  if ([nextSet isEqualToSet:self.selectionPreviewStrokeIdSet]) return;
  CGRect oldRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  _selectionPreviewStrokeIds = [ids copy];
  _selectionPreviewStrokeIdSet = nextSet;
  CGRect nextRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  [self setEditOverlayNeedsDisplayForRectChangeFrom:oldRect to:nextRect];
}

- (void)setSelectionPreviewPageNumber:(NSInteger)selectionPreviewPageNumber
{
  if (_selectionPreviewPageNumber == selectionPreviewPageNumber) return;
  CGRect oldRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  _selectionPreviewPageNumber = selectionPreviewPageNumber;
  CGRect nextRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  [self setEditOverlayNeedsDisplayForRectChangeFrom:oldRect to:nextRect];
}

- (void)setSelectionPreviewGeneratedPageId:(NSString *)selectionPreviewGeneratedPageId
{
  NSString *next = selectionPreviewGeneratedPageId.length ? [selectionPreviewGeneratedPageId copy] : nil;
  if ((_selectionPreviewGeneratedPageId == nil && next == nil) || [_selectionPreviewGeneratedPageId isEqualToString:next]) return;
  CGRect oldRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  _selectionPreviewGeneratedPageId = next;
  CGRect nextRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  [self setEditOverlayNeedsDisplayForRectChangeFrom:oldRect to:nextRect];
}

- (void)setSelectionPreviewOffsetX:(CGFloat)selectionPreviewOffsetX
{
  if (fabs(_selectionPreviewOffsetX - selectionPreviewOffsetX) < 0.01) return;
  CGRect oldRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  _selectionPreviewOffsetX = selectionPreviewOffsetX;
  CGRect nextRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  [self setEditOverlayNeedsDisplayForRectChangeFrom:oldRect to:nextRect];
}

- (void)setSelectionPreviewOffsetY:(CGFloat)selectionPreviewOffsetY
{
  if (fabs(_selectionPreviewOffsetY - selectionPreviewOffsetY) < 0.01) return;
  CGRect oldRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  _selectionPreviewOffsetY = selectionPreviewOffsetY;
  CGRect nextRect = [self selectionPreviewDirtyRectWithOffsetX:_selectionPreviewOffsetX y:_selectionPreviewOffsetY];
  [self setEditOverlayNeedsDisplayForRectChangeFrom:oldRect to:nextRect];
}

- (void)setSelectionOverlayPageNumber:(NSInteger)selectionOverlayPageNumber
{
  if (_selectionOverlayPageNumber == selectionOverlayPageNumber) return;
  [self setSelectionOverlayNeedsDisplay];
  _selectionOverlayPageNumber = selectionOverlayPageNumber;
  [self setSelectionOverlayNeedsDisplay];
}

- (void)setSelectionOverlayGeneratedPageId:(NSString *)selectionOverlayGeneratedPageId
{
  NSString *next = selectionOverlayGeneratedPageId.length ? [selectionOverlayGeneratedPageId copy] : nil;
  if ((_selectionOverlayGeneratedPageId == nil && next == nil) || [_selectionOverlayGeneratedPageId isEqualToString:next]) return;
  [self setSelectionOverlayNeedsDisplay];
  _selectionOverlayGeneratedPageId = next;
  [self setSelectionOverlayNeedsDisplay];
}

- (void)setSelectionOverlayX:(CGFloat)value { if (fabs(_selectionOverlayX - value) < 0.01) return; [self setSelectionOverlayNeedsDisplay]; _selectionOverlayX = value; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayY:(CGFloat)value { if (fabs(_selectionOverlayY - value) < 0.01) return; [self setSelectionOverlayNeedsDisplay]; _selectionOverlayY = value; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayWidth:(CGFloat)value { if (fabs(_selectionOverlayWidth - value) < 0.01) return; [self setSelectionOverlayNeedsDisplay]; _selectionOverlayWidth = value; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayHeight:(CGFloat)value { if (fabs(_selectionOverlayHeight - value) < 0.01) return; [self setSelectionOverlayNeedsDisplay]; _selectionOverlayHeight = value; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayPageWidth:(CGFloat)value { _selectionOverlayPageWidth = MAX(1.0, value); [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayPageHeight:(CGFloat)value { _selectionOverlayPageHeight = MAX(1.0, value); [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayDraft:(BOOL)value { if (_selectionOverlayDraft == value) return; _selectionOverlayDraft = value; [self setSelectionOverlayNeedsDisplay]; }

- (void)setSelectionGestureEnabled:(BOOL)selectionGestureEnabled
{
  _selectionGestureEnabled = selectionGestureEnabled;
  [self updateInkInputEnabled];
}
- (void)setSelectionMode:(NSString *)selectionMode { _selectionMode = [selectionMode isEqualToString:@"lasso"] ? @"lasso" : @"rect"; }
- (void)setSelectionOverlayMode:(NSString *)selectionOverlayMode { _selectionOverlayMode = [selectionOverlayMode isEqualToString:@"lasso"] ? @"lasso" : @"rect"; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionOverlayPath:(NSArray<NSDictionary *> *)selectionOverlayPath { _selectionOverlayPath = [selectionOverlayPath isKindOfClass:NSArray.class] ? [selectionOverlayPath copy] : @[]; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionMenuEnabled:(BOOL)value { if (_selectionMenuEnabled == value) return; [self setSelectionOverlayNeedsDisplay]; _selectionMenuEnabled = value; _selectionColorPickerOpen = NO; [self setSelectionOverlayNeedsDisplay]; }
- (void)setSelectionMenuEditable:(BOOL)value { if (_selectionMenuEditable == value) return; [self setSelectionOverlayNeedsDisplay]; _selectionMenuEditable = value; if (!value) _selectionColorPickerOpen = NO; [self setSelectionOverlayNeedsDisplay]; }
- (void)setTextGestureEnabled:(BOOL)value { if (_textGestureEnabled == value) return; _textGestureEnabled = value; [self updateInkInputEnabled]; }

- (void)setTextAnnotations:(NSArray<NSDictionary *> *)textAnnotations
{
  _textAnnotations = [textAnnotations isKindOfClass:NSArray.class] ? [textAnnotations copy] : @[];
  NSMutableDictionary<NSString *, NSDictionary *> *next = [NSMutableDictionary dictionary];
  for (NSDictionary *annotation in _textAnnotations) {
    NSString *annotationId = [RCTConvert NSString:annotation[@"id"]];
    if (annotationId.length > 0) next[annotationId] = annotation;
  }
  self.textAnnotationById = next;
  [self updateTextAnnotationViews];
}

- (void)setImageAnnotations:(NSArray<NSDictionary *> *)imageAnnotations
{
  NSArray<NSDictionary *> *previous = self.imageAnnotations ?: @[];
  _imageAnnotations = [imageAnnotations isKindOfClass:NSArray.class] ? [imageAnnotations copy] : @[];
  CGRect dirtyRect = [self dirtyRectForImageAnnotationChangesFrom:previous to:_imageAnnotations];
  if (!CGRectIsNull(dirtyRect) && !CGRectIsEmpty(dirtyRect)) {
    [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
  }
}

- (void)setPageCaptureReferences:(NSArray<NSDictionary *> *)pageCaptureReferences
{
  NSArray<NSDictionary *> *next = [pageCaptureReferences isKindOfClass:NSArray.class] ? pageCaptureReferences : @[];
  if ([_pageCaptureReferences isEqualToArray:next]) return;
  _pageCaptureReferences = [next copy];
  [self updatePageReferenceViews];
}

- (void)setOpenPageCaptureReferenceId:(NSString *)openPageCaptureReferenceId
{
  NSString *next = openPageCaptureReferenceId.length ? [openPageCaptureReferenceId copy] : nil;
  if ((_openPageCaptureReferenceId == nil && next == nil) || [_openPageCaptureReferenceId isEqualToString:next]) return;
  _openPageCaptureReferenceId = next;
  [self updatePageReferenceViews];
}

- (void)setHiddenTextAnnotationIds:(NSArray<NSString *> *)hiddenTextAnnotationIds
{
  NSArray *ids = [hiddenTextAnnotationIds isKindOfClass:NSArray.class] ? hiddenTextAnnotationIds : @[];
  _hiddenTextAnnotationIds = [ids copy];
  self.hiddenTextAnnotationIdSet = [NSSet setWithArray:ids];
  [self updateTextAnnotationViews];
}

- (void)setInkStrokes:(NSArray<NSDictionary *> *)inkStrokes
{
  NSArray<NSDictionary *> *previousVisibleStrokes = [self visibleInkStrokesIncludingPending];
  [self resetStrokeBoundsCache];

  NSArray<NSDictionary *> *incomingStrokes = [inkStrokes isKindOfClass:NSArray.class] ? inkStrokes : @[];
  NSMutableSet<NSString *> *incomingRawIds = [NSMutableSet set];
  for (NSDictionary *stroke in incomingStrokes) {
    NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
    if (strokeId.length > 0) [incomingRawIds addObject:strokeId];
  }

  if (self.pendingRemovedStrokeIds.count > 0) {
    NSMutableSet<NSString *> *ackedRemovedIds = [NSMutableSet set];
    for (NSString *strokeId in self.pendingRemovedStrokeIds) {
      if (![incomingRawIds containsObject:strokeId]) [ackedRemovedIds addObject:strokeId];
    }
    [self.pendingRemovedStrokeIds minusSet:ackedRemovedIds];
  }

  if (self.pendingRemovedStrokeIds.count > 0) {
    NSMutableArray<NSDictionary *> *filteredStrokes = [NSMutableArray arrayWithCapacity:incomingStrokes.count];
    for (NSDictionary *stroke in incomingStrokes) {
      NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
      if (strokeId.length > 0 && [self.pendingRemovedStrokeIds containsObject:strokeId]) continue;
      [filteredStrokes addObject:stroke];
    }
    _inkStrokes = [filteredStrokes copy];
  } else {
    _inkStrokes = [incomingStrokes copy];
  }

  if (self.pendingCommittedStrokes.count > 0) {
    NSMutableSet<NSString *> *incomingIds = [NSMutableSet set];
    for (NSDictionary *stroke in _inkStrokes) {
      NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
      if (strokeId.length > 0) [incomingIds addObject:strokeId];
    }
    NSMutableArray<NSDictionary *> *remainingPending = [NSMutableArray array];
    for (NSDictionary *pendingStroke in self.pendingCommittedStrokes) {
      NSString *pendingStrokeId = [RCTConvert NSString:pendingStroke[@"id"]];
      if (pendingStrokeId.length > 0 && ![incomingIds containsObject:pendingStrokeId]) {
        [remainingPending addObject:pendingStroke];
      }
    }
    self.pendingCommittedStrokes = remainingPending;
  }
  NSString *retainedStrokeId = [RCTConvert NSString:self.retainedLiveStroke[@"id"]];
  if (retainedStrokeId.length > 0 && [incomingRawIds containsObject:retainedStrokeId]) {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(clearRetainedLiveStroke) object:nil];
    [self performSelector:@selector(clearRetainedLiveStroke) withObject:nil afterDelay:0.08];
  }
  self.activePredictedStroke = nil;
  self.lastEraserPoint = nil;
  self.eraserOriginalStrokeIds = nil;
  [self resetStrokeBoundsCache];

  NSArray<NSDictionary *> *nextVisibleStrokes = [self visibleInkStrokesIncludingPending];
  CGRect dirtyRect = [self dirtyRectForStrokeChangesFrom:previousVisibleStrokes to:nextVisibleStrokes];
  if (!CGRectIsNull(dirtyRect) && !CGRectIsEmpty(dirtyRect)) {
    [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
  }
}

- (void)openDocument
{
  [self stopInertia];
  NSDictionary *savedAnchor = self.fileUri.length > 0 ? BsnPdfSavedViewportAnchors()[self.fileUri] : nil;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] openDocument begin file=%@ savedPage=%ld requested=%ld offsetY=%.1f",
    self.fileUri ?: @"",
    (long)[savedAnchor[@"pageNumber"] integerValue],
    (long)self.requestedPage,
    self.scrollView.contentOffset.y);
  self.document = nil;
  self.layouts = @[];
  self.activeStroke = nil;
  self.activePredictedStroke = nil;
  self.lastEraserPoint = nil;
  self.retainedLiveStroke = nil;
  self.retainedLiveStrokeDirtyRect = CGRectNull;
  [self.pendingRemovedStrokeIds removeAllObjects];
  [self.pendingCommittedStrokes removeAllObjects];
  [self resetStrokeBoundsCache];
  [self.deferredCommitStrokes removeAllObjects];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(clearRetainedLiveStroke) object:nil];
  self.deferredCommitScheduled = NO;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(flushDeferredInkCommits) object:nil];
  self.deferredContentInvalidation = NO;
  self.deferredContentInvalidationRect = CGRectNull;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(flushDeferredContentInvalidation) object:nil];
  self.deferredEditOverlayInvalidation = NO;
  self.deferredEditOverlayInvalidationRect = CGRectNull;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(performDeferredWidthLayoutRebuild) object:nil];
  self.deferredWidthLayoutPending = NO;
  self.pendingDeferredLayoutSize = CGSizeZero;
  self.loadErrorMessage = nil;
  self.lastPageNumber = 0;
  self.reportedPageNumber = 0;
  self.pendingScrollToRequestedPage = savedAnchor == nil;
  self.hasAppliedInitialPage = savedAnchor != nil;
  self.viewportEventScheduled = NO;
  self.renderGeneration += 1;
  self.hiResGeneration += 1;
  self.baseRenderDirection = 0;
  self.lastBaseRenderScheduleKey = @"";
  self.lastViewportEventKey = @"";
  self.lastPerfLogTime = 0;
  self.baseCacheHits = 0;
  self.baseCacheMisses = 0;
  self.baseRenderCompletedCount = 0;
  self.hiResRenderCompletedCount = 0;
  self.protectedPageNumber = 0;
  self.suppressScrollPageEventsUntil = 0;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitViewportChangedThrottled) object:nil];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitPageChangedDebounced) object:nil];
  [self.baseRenderQueue cancelAllOperations];
  [self.hiResRenderQueue cancelAllOperations];
  [self.baseBitmapCache removeAllObjects];
  [self.latestBaseImageByPageNumber removeAllObjects];
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
    @try {
      self.document = [[PDFDocument alloc] initWithURL:url];
      if (self.document == nil || self.document.pageCount <= 0) {
        self.loadErrorMessage = @"PDF open failed.";
        self.document = nil;
      }
    } @catch (NSException *exception) {
      self.loadErrorMessage = @"PDF open failed.";
      self.document = nil;
    }
  }
  [self rebuildLayout];
  if (savedAnchor != nil && self.layouts.count > 0) {
    [self restoreViewportAnchor:savedAnchor];
    [self scheduleBaseRendersForce:YES];
    [self requestViewportChangedForce:YES];
  }
  if (self.document != nil && self.onDocumentLoaded != nil) {
    self.onDocumentLoaded(@{@"pageCount": @(self.document.pageCount)});
  }
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] openDocument done pages=%ld last=%ld reported=%ld offsetY=%.1f contentH=%.1f",
    (long)(self.document != nil ? self.document.pageCount : 0),
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    self.scrollView.contentOffset.y,
    self.scrollView.contentSize.height);
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

- (void)drawDocumentPagesInContext:(CGContextRef)context dirtyRect:(CGRect)rect drawEditing:(BOOL)drawEditing
{
  [[UIColor colorWithRed:0.95 green:0.96 blue:0.98 alpha:1.0] setFill];
  CGContextFillRect(context, rect);

  if (self.layouts.count == 0) {
    NSDictionary *attrs = @{
      NSFontAttributeName: [UIFont systemFontOfSize:14 weight:UIFontWeightSemibold],
      NSForegroundColorAttributeName: [UIColor colorWithRed:0.50 green:0.55 blue:0.65 alpha:1.0],
    };
    NSString *message = [self emptyStateMessage];
    CGSize size = [message sizeWithAttributes:attrs];
    [message drawAtPoint:CGPointMake((self.bounds.size.width - size.width) * 0.5, (self.bounds.size.height - size.height) * 0.5) withAttributes:attrs];
    return;
  }

  CGFloat zoom = MAX(1.0, [self viewportScale]);
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (!CGRectIntersectsRect(rect, layout.frame)) continue;
    [[UIColor whiteColor] setFill];
    CGContextFillRect(context, layout.frame);

    if ([layout.kind isEqualToString:@"pdf"] && layout.pageNumber != nil && self.document != nil) {
      UIImage *baseImage = [self baseImageForPageNumber:layout.pageNumber.integerValue];
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
        [self requestBaseRenderForLayout:layout priority:0];
      }
      [self drawHiResOverlayForLayout:layout inContext:context];
    } else {
      [[UIColor colorWithRed:1.0 green:0.99 blue:0.97 alpha:1.0] setFill];
      CGContextFillRect(context, layout.frame);
      NSDictionary *attrs = @{
        NSFontAttributeName: [UIFont systemFontOfSize:13 weight:UIFontWeightSemibold],
        NSForegroundColorAttributeName: [UIColor colorWithRed:0.72 green:0.44 blue:0.12 alpha:1.0],
      };
      [layout.label drawAtPoint:CGPointMake(layout.frame.origin.x + 32, layout.frame.origin.y + 32) withAttributes:attrs];
    }

    if (drawEditing) {
      [self drawImageAnnotationsForLayout:layout inContext:context];
      [self drawInkForLayout:layout inContext:context];
      [self drawSelectionOverlayForLayout:layout inContext:context];
      [self drawSelectionMenuForLayout:layout inContext:context];
    }

    [[UIColor colorWithRed:0.88 green:0.9 blue:0.94 alpha:1.0] setStroke];
    CGContextStrokeRectWithWidth(context, layout.frame, 1.0 / zoom);
  }
}

- (void)drawCustomCoreInContext:(CGContextRef)context dirtyRect:(CGRect)rect
{
  [[UIColor colorWithRed:0.95 green:0.96 blue:0.98 alpha:1.0] setFill];
  CGContextFillRect(context, rect);
  if (!self.customViewportCoreEnabled) return;

  if (self.layouts.count == 0) {
    NSDictionary *attrs = @{
      NSFontAttributeName: [UIFont systemFontOfSize:14 weight:UIFontWeightSemibold],
      NSForegroundColorAttributeName: [UIColor colorWithRed:0.50 green:0.55 blue:0.65 alpha:1.0],
    };
    NSString *message = [self emptyStateMessage];
    CGSize size = [message sizeWithAttributes:attrs];
    [message drawAtPoint:CGPointMake((self.bounds.size.width - size.width) * 0.5, (self.bounds.size.height - size.height) * 0.5) withAttributes:attrs];
    return;
  }

  CGFloat zoom = MAX(0.0001, self.coreScale);
  CGPoint offset = CGPointMake(-self.coreTranslateX, self.coreScrollYDocument * zoom);
  CGRect contentDirtyRect = CGRectMake(
    (rect.origin.x + offset.x) / zoom,
    (rect.origin.y + offset.y) / zoom,
    rect.size.width / zoom,
    rect.size.height / zoom
  );

  CGContextSaveGState(context);
  CGContextTranslateCTM(context, -offset.x, -offset.y);
  CGContextScaleCTM(context, zoom, zoom);
  [self drawDocumentPagesInContext:context dirtyRect:contentDirtyRect drawEditing:YES];
  CGContextRestoreGState(context);
}

- (CGRect)safeBoundsForPage:(PDFPage *)page displayBox:(PDFDisplayBox *)displayBox
{
  PDFDisplayBox selectedBox = kPDFDisplayBoxCropBox;
  CGRect bounds = CGRectNull;
  @try {
    bounds = [page boundsForBox:selectedBox];
    if (CGRectIsEmpty(bounds) || bounds.size.width <= 0 || bounds.size.height <= 0 || !isfinite(bounds.size.width) || !isfinite(bounds.size.height)) {
      selectedBox = kPDFDisplayBoxMediaBox;
      bounds = [page boundsForBox:selectedBox];
    }
  } @catch (NSException *exception) {
    bounds = CGRectNull;
  }
  if (CGRectIsEmpty(bounds) || bounds.size.width <= 0 || bounds.size.height <= 0 || !isfinite(bounds.size.width) || !isfinite(bounds.size.height)) {
    bounds = CGRectMake(0, 0, 612, 792);
    selectedBox = kPDFDisplayBoxMediaBox;
  }
  CGFloat width = MAX(1.0, fabs(bounds.size.width));
  CGFloat height = MAX(1.0, fabs(bounds.size.height));
  CGFloat aspect = width / height;
  if (!isfinite(aspect) || aspect <= 0) {
    width = 612;
    height = 792;
  } else if (aspect > BsnPdfMaxPageAspectRatio) {
    width = height * BsnPdfMaxPageAspectRatio;
  } else if (aspect < 1.0 / BsnPdfMaxPageAspectRatio) {
    height = width * BsnPdfMaxPageAspectRatio;
  }
  if (displayBox != NULL) *displayBox = selectedBox;
  return CGRectMake(bounds.origin.x, bounds.origin.y, width, height);
}

- (CGSize)safeLogicalSizeForPage:(PDFPage *)page
{
  if (page == nil) return CGSizeMake(612, 792);
  CGRect bounds = [self safeBoundsForPage:page displayBox:NULL];
  return CGSizeMake(MAX(1.0, bounds.size.width), MAX(1.0, bounds.size.height));
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
  CGFloat maxVisiblePageHeight = MAX(1.0, self.bounds.size.height - BsnPdfFitVerticalInset * 2.0);
  CGFloat horizontalInset = MIN(BsnPdfMaxHorizontalPageInset, MAX(BsnPdfMinHorizontalPageInset, contentWidth * 0.028));
  CGFloat maxPageFrameWidth = MAX(1.0, contentWidth - horizontalInset * 2.0);
  CGFloat y = 0;
  for (NSDictionary *pageInfo in sourcePages) {
    NSString *kind = [RCTConvert NSString:pageInfo[@"kind"]] ?: @"pdf";
    NSNumber *pageNumber = pageInfo[@"pageNumber"] != nil ? [RCTConvert NSNumber:pageInfo[@"pageNumber"]] : nil;
    if ([kind isEqualToString:@"pdf"] && (pageNumber == nil || pageNumber.integerValue < 1 || pageNumber.integerValue > pageCount)) continue;

    CGSize logicalSize = CGSizeMake(612, 792);
    if ([kind isEqualToString:@"pdf"] && pageNumber != nil) {
      PDFPage *pdfPage = nil;
      @try {
        pdfPage = [self.document pageAtIndex:pageNumber.integerValue - 1];
      } @catch (NSException *exception) {
        pdfPage = nil;
      }
      logicalSize = [self safeLogicalSizeForPage:pdfPage];
    }
    CGFloat heightFitWidth = maxVisiblePageHeight * logicalSize.width / MAX(1.0, logicalSize.height);
    CGFloat pageFrameWidth = MIN(maxPageFrameWidth, MAX(1.0, heightFitWidth));
    CGFloat pageFrameX = MAX(0, (contentWidth - pageFrameWidth) * 0.5);
    CGFloat pageHeight = pageFrameWidth * logicalSize.height / MAX(1.0, logicalSize.width);

    BsnPdfPageLayout *layout = [BsnPdfPageLayout new];
    layout.kind = kind;
    layout.pageNumber = pageNumber;
    layout.generatedPageId = pageInfo[@"generatedPageId"] != nil ? [RCTConvert NSString:pageInfo[@"generatedPageId"]] : nil;
    layout.pageId = layout.generatedPageId ?: (pageNumber != nil ? [NSString stringWithFormat:@"pdf:%@", pageNumber] : ([RCTConvert NSString:pageInfo[@"id"]] ?: [NSUUID UUID].UUIDString));
    layout.label = [RCTConvert NSString:pageInfo[@"label"]] ?: (pageNumber != nil ? [NSString stringWithFormat:@"%@p", pageNumber] : @"Page");
    layout.logicalSize = logicalSize;
    layout.frame = CGRectMake(pageFrameX, y, pageFrameWidth, pageHeight);
    [result addObject:layout];
    y += pageHeight + BsnPdfPageGap;
  }
  return result;
}

- (nullable NSDictionary *)captureViewportAnchor
{
  if (self.layouts.count == 0 || self.bounds.size.height <= 0) return nil;
  CGFloat zoom = MAX(1.0, [self viewportScale]);
  CGPoint offset = [self viewportContentOffset];
  CGFloat centerY = (offset.y + self.bounds.size.height * 0.5) / zoom;
  BsnPdfPageLayout *containing = nil;
  BsnPdfPageLayout *before = nil;
  BsnPdfPageLayout *after = nil;
  BsnPdfPageLayout *best = nil;
  CGFloat bestDistance = CGFLOAT_MAX;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (CGRectContainsPoint(layout.frame, CGPointMake(CGRectGetMidX(layout.frame), centerY))) {
      containing = layout;
    }
    if (CGRectGetMaxY(layout.frame) <= centerY) before = layout;
    if (after == nil && CGRectGetMinY(layout.frame) >= centerY) after = layout;
    CGFloat distance = containing == layout ? 0 : fabs(CGRectGetMidY(layout.frame) - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = layout;
    }
  }
  if (containing == nil && before != nil && after != nil) {
    CGFloat gapTop = CGRectGetMaxY(before.frame);
    CGFloat gapBottom = CGRectGetMinY(after.frame);
    CGFloat gapHeight = MAX(1.0, gapBottom - gapTop);
    CGFloat gapProgress = MIN(1.0, MAX(0, (centerY - gapTop) / gapHeight));
    NSMutableDictionary *gapAnchor = [@{
      @"isGapAnchor": @YES,
      @"gapBeforePageId": before.pageId ?: @"",
      @"gapAfterPageId": after.pageId ?: @"",
      @"gapProgressY": @(gapProgress),
    } mutableCopy];
    if (before.pageNumber != nil) gapAnchor[@"gapBeforePageNumber"] = before.pageNumber;
    if (after.pageNumber != nil) gapAnchor[@"gapAfterPageNumber"] = after.pageNumber;
    NSInteger stablePage = self.lastPageNumber > 0 ? self.lastPageNumber : (before.pageNumber != nil ? before.pageNumber.integerValue : 0);
    if (stablePage > 0) gapAnchor[@"pageNumber"] = @(stablePage);
    return gapAnchor;
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

- (void)saveViewportAnchor
{
  if (self.fileUri.length == 0) return;
  NSDictionary *anchor = [self captureViewportAnchor];
  if (anchor == nil) return;

  NSDictionary *current = BsnPdfSavedViewportAnchors()[self.fileUri];
  NSInteger nextPage = [anchor[@"pageNumber"] integerValue];
  NSInteger currentPage = [current[@"pageNumber"] integerValue];
  BOOL suppressingLayoutAnchor = [self isSuppressingProgrammaticLayout];
  if (suppressingLayoutAnchor && currentPage > 1 && nextPage <= 1) return;
  if (
    CACurrentMediaTime() < self.suppressScrollPageEventsUntil
    && self.protectedPageNumber > 1
    && nextPage > 0
    && nextPage != self.protectedPageNumber
  ) {
    return;
  }

  BsnPdfSavedViewportAnchors()[self.fileUri] = anchor;
}

- (void)restoreViewportAnchor:(NSDictionary *)anchor
{
  if (anchor == nil || self.layouts.count == 0 || self.bounds.size.height <= 0) return;
  NSString *pageId = [RCTConvert NSString:anchor[@"pageId"]];
  NSString *generatedPageId = [RCTConvert NSString:anchor[@"generatedPageId"]];
  NSNumber *pageNumber = anchor[@"pageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"pageNumber"]] : nil;
  if ([anchor[@"isGapAnchor"] boolValue]) {
    NSString *beforePageId = [RCTConvert NSString:anchor[@"gapBeforePageId"]];
    NSString *afterPageId = [RCTConvert NSString:anchor[@"gapAfterPageId"]];
    NSNumber *beforePageNumber = anchor[@"gapBeforePageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"gapBeforePageNumber"]] : nil;
    NSNumber *afterPageNumber = anchor[@"gapAfterPageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"gapAfterPageNumber"]] : nil;
    BsnPdfPageLayout *before = nil;
    BsnPdfPageLayout *after = nil;
    for (BsnPdfPageLayout *layout in self.layouts) {
      if (before == nil && ((beforePageId.length > 0 && [layout.pageId isEqualToString:beforePageId])
        || (beforePageNumber != nil && layout.pageNumber != nil && layout.pageNumber.integerValue == beforePageNumber.integerValue))) {
        before = layout;
      }
      if (after == nil && ((afterPageId.length > 0 && [layout.pageId isEqualToString:afterPageId])
        || (afterPageNumber != nil && layout.pageNumber != nil && layout.pageNumber.integerValue == afterPageNumber.integerValue))) {
        after = layout;
      }
    }
    if (before != nil && after != nil) {
      CGFloat progress = MIN(1.0, MAX(0, [anchor[@"gapProgressY"] doubleValue]));
      CGFloat zoom = MAX(BsnPdfMinZoom, self.scrollView.zoomScale);
      CGFloat gapTop = CGRectGetMaxY(before.frame);
      CGFloat gapBottom = CGRectGetMinY(after.frame);
      CGFloat centerY = gapTop + MAX(1.0, gapBottom - gapTop) * progress;
      CGFloat nextY = centerY * zoom - self.bounds.size.height * 0.5;
      CGFloat maxY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
      CGFloat beforeY = self.scrollView.contentOffset.y;
      CGFloat targetY = MIN(MAX(0, nextY), maxY);
      BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] restoreViewportGapAnchor before=%@ after=%@ progress=%.3f beforeY=%.1f targetY=%.1f maxY=%.1f last=%ld reported=%ld",
        before.pageId ?: @"",
        after.pageId ?: @"",
        progress,
        beforeY,
        targetY,
        maxY,
        (long)self.lastPageNumber,
        (long)self.reportedPageNumber);
      if (pageNumber != nil && pageNumber.integerValue > 0) {
        self.protectedPageNumber = pageNumber.integerValue;
        self.suppressScrollPageEventsUntil = CACurrentMediaTime() + 0.9;
        self.suppressAnchorSaveUntil = MAX(self.suppressAnchorSaveUntil, CACurrentMediaTime() + 0.9);
      }
      [self stopInertia];
      [self.scrollView.layer removeAllAnimations];
      [self.scrollView setContentOffset:self.scrollView.contentOffset animated:NO];
      [CATransaction begin];
      [CATransaction setDisableActions:YES];
      [UIView performWithoutAnimation:^{
        self.restoringViewportAnchor = YES;
        [self.scrollView setContentOffset:CGPointMake(self.scrollView.contentOffset.x, targetY) animated:NO];
        [self.scrollView layoutIfNeeded];
        self.restoringViewportAnchor = NO;
      }];
      [CATransaction commit];
      self.lastContentOffsetY = self.scrollView.contentOffset.y;
      if (self.customViewportCoreEnabled) {
        [self syncCustomCoreFromScrollView];
        [self invalidateCustomViewportSurfaces];
      }
      [self saveViewportAnchor];
      return;
    }
  }
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
  CGFloat beforeY = self.scrollView.contentOffset.y;
  CGFloat targetY = MIN(MAX(0, nextY), maxY);
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] restoreViewportAnchor page=%ld pageId=%@ progress=%.3f beforeY=%.1f targetY=%.1f maxY=%.1f last=%ld reported=%ld",
    (long)(pageNumber != nil ? pageNumber.integerValue : 0),
    pageId ?: @"",
    progress,
    beforeY,
    targetY,
    maxY,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber);
  if (pageNumber != nil && pageNumber.integerValue > 0) {
    self.protectedPageNumber = pageNumber.integerValue;
    self.suppressScrollPageEventsUntil = CACurrentMediaTime() + 0.9;
    self.suppressAnchorSaveUntil = MAX(self.suppressAnchorSaveUntil, CACurrentMediaTime() + 0.9);
  }
  [self stopInertia];
  [self.scrollView.layer removeAllAnimations];
  [self.scrollView setContentOffset:self.scrollView.contentOffset animated:NO];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [UIView performWithoutAnimation:^{
    self.restoringViewportAnchor = YES;
    [self.scrollView setContentOffset:CGPointMake(self.scrollView.contentOffset.x, targetY) animated:NO];
    [self.scrollView layoutIfNeeded];
    self.restoringViewportAnchor = NO;
  }];
  [CATransaction commit];
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
  if (self.customViewportCoreEnabled) {
    [self syncCustomCoreFromScrollView];
    [self invalidateCustomViewportSurfaces];
  }
  [self saveViewportAnchor];
}

- (BOOL)restoreAnchorIfNeededForLayoutResetScroll
{
  if (self.restoringViewportAnchor) return NO;
  if (![self isSuppressingProgrammaticLayout]) return NO;
  if ([self isViewportUserInteractionActive]) return NO;
  NSDictionary *anchor = self.fileUri.length > 0 ? BsnPdfSavedViewportAnchors()[self.fileUri] : nil;
  NSInteger anchorPage = [anchor[@"pageNumber"] integerValue];
  if (anchorPage <= 1) return NO;
  NSInteger stablePage = [self stablePageForProgrammaticLayout];
  CGFloat resetThreshold = MAX(2.0, self.bounds.size.height * 0.55);
  if (stablePage > 1 && self.scrollView.contentOffset.y > resetThreshold) return NO;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] restoreAfterLayoutResetScroll anchorPage=%ld last=%ld reported=%ld offsetY=%.1f",
    (long)anchorPage,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    self.scrollView.contentOffset.y);
  self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.75;
  [self restoreViewportAnchor:anchor];
  self.lastPageNumber = anchorPage;
  self.reportedPageNumber = anchorPage;
  _requestedPage = anchorPage;
  self.pendingScrollToRequestedPage = NO;
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
  [self requestViewportChangedForce:YES];
  return YES;
}

- (BOOL)restoreProtectedPageAfterProgrammaticScrollCandidate:(NSInteger)pageNumber source:(NSString *)source
{
  if (self.protectedPageNumber <= 1) return NO;
  if ([self isViewportUserInteractionActive]) return NO;
  NSDictionary *anchor = self.fileUri.length > 0 ? BsnPdfSavedViewportAnchors()[self.fileUri] : nil;
  NSInteger anchorPage = [anchor[@"pageNumber"] integerValue];
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] restoreProtectedProgrammaticScroll source=%@ candidate=%ld protected=%ld anchorPage=%ld offsetY=%.1f",
    source ?: @"unknown",
    (long)pageNumber,
    (long)self.protectedPageNumber,
    (long)anchorPage,
    self.scrollView.contentOffset.y);
  self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.9;
  self.suppressScrollPageEventsUntil = CACurrentMediaTime() + 0.9;
  self.lastPageNumber = self.protectedPageNumber;
  self.reportedPageNumber = self.protectedPageNumber;
  _requestedPage = self.protectedPageNumber;
  self.pendingScrollToRequestedPage = NO;
  if (anchor != nil && anchorPage == self.protectedPageNumber) {
    [self restoreViewportAnchor:anchor];
  } else {
    [self scrollToPageNumber:self.protectedPageNumber reason:@"protected-programmatic-scroll"];
  }
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
  [self requestViewportChangedForce:YES];
  return YES;
}

- (BOOL)isSuppressingProgrammaticLayout
{
  return CACurrentMediaTime() < self.suppressAnchorSaveUntil
    && ![self isViewportUserInteractionActive];
}

- (NSInteger)savedAnchorPageNumber
{
  if (self.fileUri.length == 0) return 0;
  NSDictionary *anchor = BsnPdfSavedViewportAnchors()[self.fileUri];
  return [anchor[@"pageNumber"] integerValue];
}

- (NSInteger)stablePageForProgrammaticLayout
{
  NSInteger stablePage = MAX(self.lastPageNumber, self.reportedPageNumber);
  NSInteger anchorPage = [self savedAnchorPageNumber];
  if (anchorPage > 1) stablePage = MAX(stablePage, anchorPage);
  return stablePage;
}

- (BOOL)scrollToPageNumber:(NSInteger)pageNumber reason:(NSString *)reason
{
  if (pageNumber < 1 || self.layouts.count == 0) return NO;
  BsnPdfPageLayout *target = nil;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (layout.pageNumber != nil && layout.pageNumber.integerValue == pageNumber) {
      target = layout;
      break;
    }
  }
  if (target == nil) return NO;
  CGFloat zoom = MAX(BsnPdfMinZoom, self.scrollView.zoomScale);
  CGFloat y = target.frame.origin.y * zoom;
  CGFloat maxY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
  CGFloat targetY = MIN(MAX(0, y), maxY);
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] scrollToPageNumber reason=%@ page=%ld beforeY=%.1f targetY=%.1f maxY=%.1f last=%ld reported=%ld requested=%ld",
    reason ?: @"unknown",
    (long)pageNumber,
    self.scrollView.contentOffset.y,
    targetY,
    maxY,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    (long)self.requestedPage);
  [self stopInertia];
  [self.scrollView.layer removeAllAnimations];
  [self.scrollView setContentOffset:self.scrollView.contentOffset animated:NO];
  self.protectedPageNumber = pageNumber;
  self.suppressScrollPageEventsUntil = CACurrentMediaTime() + 0.9;
  self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.75;
  self.restoringViewportAnchor = YES;
  self.scrollView.contentOffset = CGPointMake(0, targetY);
  self.restoringViewportAnchor = NO;
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
  self.lastPageNumber = pageNumber;
  self.reportedPageNumber = pageNumber;
  if (self.customViewportCoreEnabled) {
    [self syncCustomCoreFromScrollView];
    [self invalidateCustomViewportSurfaces];
  }
  [self saveViewportAnchor];
  [self setContentNeedsDisplaySafely];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
  [self requestViewportChangedForce:YES];
  return YES;
}

- (NSInteger)pageNumberNearContentPoint:(CGPoint)contentPoint
{
  NSInteger bestPageNumber = 0;
  CGFloat bestDistance = CGFLOAT_MAX;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (layout.pageNumber == nil) continue;
    if (CGRectContainsPoint(layout.frame, contentPoint)) return layout.pageNumber.integerValue;
    CGFloat dx = 0;
    if (contentPoint.x < CGRectGetMinX(layout.frame)) dx = CGRectGetMinX(layout.frame) - contentPoint.x;
    else if (contentPoint.x > CGRectGetMaxX(layout.frame)) dx = contentPoint.x - CGRectGetMaxX(layout.frame);
    CGFloat dy = 0;
    if (contentPoint.y < CGRectGetMinY(layout.frame)) dy = CGRectGetMinY(layout.frame) - contentPoint.y;
    else if (contentPoint.y > CGRectGetMaxY(layout.frame)) dy = contentPoint.y - CGRectGetMaxY(layout.frame);
    CGFloat distance = hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPageNumber = layout.pageNumber.integerValue;
    }
  }
  return bestPageNumber;
}

- (BOOL)restoreStablePageIfNeededForLayoutResetCandidate:(NSInteger)pageNumber source:(NSString *)source
{
  if (![source isEqualToString:@"scrollViewDidScroll"]) return NO;
  if (CACurrentMediaTime() >= self.suppressAnchorSaveUntil) return NO;
  if ([self isViewportUserInteractionActive]) return NO;
  NSInteger stablePage = MAX(MAX(self.requestedPage, self.reportedPageNumber), self.lastPageNumber);
  if (stablePage <= 1 || pageNumber >= stablePage) return NO;

  NSDictionary *anchor = self.fileUri.length > 0 ? BsnPdfSavedViewportAnchors()[self.fileUri] : nil;
  NSInteger anchorPage = [anchor[@"pageNumber"] integerValue];
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore pageCandidate source=%@ page=%ld previousLast=%ld stablePage=%ld anchorPage=%ld reason=layout-reset offsetY=%.1f",
    source,
    (long)pageNumber,
    (long)self.lastPageNumber,
    (long)stablePage,
    (long)anchorPage,
    self.scrollView.contentOffset.y);

  if (anchorPage == stablePage) {
    self.suppressAnchorSaveUntil = CACurrentMediaTime() + 0.75;
    self.lastPageNumber = stablePage;
    self.reportedPageNumber = stablePage;
    [self restoreViewportAnchor:anchor];
    return YES;
  }

  [self scrollToPageNumber:stablePage reason:@"layout-reset-stable-page"];
  return YES;
}

- (void)rebuildLayout
{
  [self logRenderDebugEvent:@"layout" target:@"viewport" action:@"rebuild-enter" rect:self.bounds extra:[NSString stringWithFormat:@"pendingScroll=%@", self.pendingScrollToRequestedPage ? @"YES" : @"NO"]];
  NSDictionary *customLayoutAnchor = self.pendingCustomLayoutAnchor;
  CGPoint customLayoutViewPoint = self.pendingCustomLayoutViewPoint;
  NSString *customLayoutReason = self.pendingCustomLayoutReason;
  self.pendingCustomLayoutAnchor = nil;
  self.pendingCustomLayoutViewPoint = CGPointZero;
  self.pendingCustomLayoutReason = nil;
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0 || self.document == nil) {
    self.pendingLayoutTransitionAnchor = nil;
    self.contentView.frame = CGRectMake(0, 0, MAX(1.0, self.bounds.size.width), MAX(1.0, self.bounds.size.height));
    self.editOverlayView.frame = self.contentView.bounds;
    self.liveInkView.frame = self.bounds;
    self.scrollView.contentSize = self.contentView.frame.size;
    self.coreContentWidth = self.contentView.bounds.size.width;
    self.coreContentHeight = self.contentView.bounds.size.height;
    if (self.customViewportCoreEnabled) {
      [self clampCustomViewportSnap:NO];
      [self syncScrollViewFromCustomCore];
      [self.customCoreView setNeedsDisplay];
    }
    [self updateTextAnnotationViews];
    [self updatePageReferenceViews];
    [self setContentNeedsDisplaySafely];
    [self setEditOverlayNeedsDisplaySafely];
    [self requestViewportChangedForce:YES];
    [self logRenderDebugEvent:@"layout" target:@"viewport" action:@"rebuild-empty" rect:self.bounds extra:@""];
    return;
  }

  BOOL hasCustomLayoutAnchor = self.customViewportCoreEnabled && customLayoutAnchor != nil;
  NSDictionary *anchor = nil;
  if (!self.pendingScrollToRequestedPage && !hasCustomLayoutAnchor) {
    anchor = self.pendingLayoutTransitionAnchor ?: [self captureViewportAnchor];
  }
  self.pendingLayoutTransitionAnchor = nil;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] rebuildLayout begin pendingScroll=%@ anchorPage=%ld bounds=%.1fx%.1f offsetY=%.1f last=%ld reported=%ld",
    self.pendingScrollToRequestedPage ? @"YES" : @"NO",
    (long)[anchor[@"pageNumber"] integerValue],
    self.bounds.size.width,
    self.bounds.size.height,
    self.scrollView.contentOffset.y,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber);
  CGFloat previousZoom = MAX(BsnPdfMinZoom, self.customViewportCoreEnabled ? self.coreScale : self.scrollView.zoomScale);
  self.layouts = [self buildNotebookLayouts];
  BsnPdfPageLayout *last = self.layouts.lastObject;
  CGFloat contentHeight = last != nil ? CGRectGetMaxY(last.frame) : self.bounds.size.height;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.contentView.frame = CGRectMake(0, 0, MAX(1.0, self.bounds.size.width), MAX(1.0, contentHeight));
  self.editOverlayView.frame = self.contentView.bounds;
  self.liveInkView.frame = self.bounds;
  self.scrollView.contentSize = self.contentView.frame.size;
  self.coreContentWidth = self.contentView.bounds.size.width;
  self.coreContentHeight = self.contentView.bounds.size.height;
  [CATransaction commit];
  [self updateTextAnnotationViews];
  [self updatePageReferenceViews];
  self.scrollView.minimumZoomScale = BsnPdfMinZoom;
  self.scrollView.maximumZoomScale = BsnPdfMaxZoom;
  self.scrollView.zoomScale = MIN(BsnPdfMaxZoom, MAX(BsnPdfMinZoom, previousZoom));
  if (hasCustomLayoutAnchor) {
    CGPoint fallbackContentPoint = CGPointMake(
      [customLayoutAnchor[@"contentX"] doubleValue],
      [customLayoutAnchor[@"contentY"] doubleValue]
    );
    CGPoint focusContentPoint = [self contentPointForCustomViewportAnchor:customLayoutAnchor fallbackContentPoint:fallbackContentPoint];
    [self preserveCustomViewportContentPoint:focusContentPoint atViewPoint:customLayoutViewPoint reason:customLayoutReason ?: @"layout"];
  } else if (anchor != nil) {
    [self restoreViewportAnchor:anchor];
  }
  if (self.customViewportCoreEnabled) {
    if (!hasCustomLayoutAnchor && anchor == nil) [self syncCustomCoreFromScrollView];
    [self clampCustomViewportSnap:NO];
    [self syncScrollViewFromCustomCore];
  } else {
    CGFloat maxOffsetX = MAX(0, self.scrollView.contentSize.width - self.bounds.size.width);
    CGFloat maxOffsetY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
    self.scrollView.contentOffset = CGPointMake(
      MIN(MAX(0, self.scrollView.contentOffset.x), maxOffsetX),
      MIN(MAX(0, self.scrollView.contentOffset.y), maxOffsetY)
    );
  }
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] rebuildLayout done offsetY=%.1f contentH=%.1f last=%ld reported=%ld requested=%ld",
    self.scrollView.contentOffset.y,
    self.scrollView.contentSize.height,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    (long)self.requestedPage);
  [self setContentNeedsDisplaySafely];
  [self setEditOverlayNeedsDisplaySafely];
  if (self.customViewportCoreEnabled) [self.customCoreView setNeedsDisplay];
  [self scrollToRequestedPageIfNeeded];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
  [self requestViewportChangedForce:YES];
  [self logRenderDebugEvent:@"layout" target:@"viewport" action:@"rebuild-done" rect:self.bounds extra:[NSString stringWithFormat:@"contentH=%.1f", self.scrollView.contentSize.height]];
}

- (UIView *)viewForZoomingInScrollView:(UIScrollView *)scrollView
{
  return self.contentView;
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  if ([self isCustomViewportDrivingScroll]) {
    self.lastContentOffsetY = scrollView.contentOffset.y;
    return;
  }
  if ([self restoreAnchorIfNeededForLayoutResetScroll]) return;
  CGFloat deltaY = scrollView.contentOffset.y - self.lastContentOffsetY;
  self.lastContentOffsetY = scrollView.contentOffset.y;
  [self logScrollDebugWithSource:@"scrollViewDidScroll" deltaY:deltaY force:fabs(deltaY) > MAX(80.0, self.bounds.size.height * 0.25)];
  [self updateBaseRenderDirection:deltaY];
  [self scheduleBaseRendersForce:NO];
  if (![self isViewportMotionActive]) {
    [self requestHiResOverlayAfterDelay:160];
  }
  if (!self.viewportPinchActive) {
    [self emitPageChangedIfNeededFromSource:@"scrollViewDidScroll"];
    [self saveViewportAnchor];
  }
  [self requestViewportChangedForce:NO];
}

- (void)scrollViewDidZoom:(UIScrollView *)scrollView
{
  if (self.viewportPinchActive) {
    self.lastContentOffsetY = scrollView.contentOffset.y;
    return;
  }
  [self logScrollDebugWithSource:@"scrollViewDidZoom" deltaY:0 force:YES];
  [self scheduleBaseRendersForce:NO];
  if (![self isViewportMotionActive]) {
    [self requestHiResOverlayAfterDelay:160];
  }
  [self emitPageChangedIfNeededFromSource:@"scrollViewDidZoom"];
  [self requestViewportChangedForce:NO];
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate
{
  [self logScrollDebugWithSource:decelerate ? @"scrollViewDidEndDragging/decelerate" : @"scrollViewDidEndDragging" deltaY:0 force:YES];
  if (!decelerate) {
    [self resetBaseRenderDirection];
    [self scheduleBaseRendersForce:YES];
    [self requestHiResOverlayAfterDelay:160];
    [self flushDeferredViewportInvalidations];
  }
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView
{
  [self logScrollDebugWithSource:@"scrollViewDidEndDecelerating" deltaY:0 force:YES];
  [self resetBaseRenderDirection];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:160];
  [self flushDeferredViewportInvalidations];
}

- (void)scrollViewDidEndZooming:(UIScrollView *)scrollView withView:(UIView *)view atScale:(CGFloat)scale
{
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:160];
  [self flushDeferredViewportInvalidations];
}

- (void)clampViewportOffsetSnap:(BOOL)snap
{
  [self clampViewportOffsetSnap:snap preservingContentPoint:CGPointMake(NAN, NAN) atViewPoint:CGPointZero];
}

- (void)clampViewportOffsetSnap:(BOOL)snap preservingContentPoint:(CGPoint)contentPoint atViewPoint:(CGPoint)viewPoint
{
  CGFloat currentZoom = MAX(0.0001, self.scrollView.zoomScale);
  CGPoint currentOffset = self.scrollView.contentOffset;
  CGPoint centerContentPoint = CGPointMake(
    (currentOffset.x + self.bounds.size.width * 0.5) / currentZoom,
    (currentOffset.y + self.bounds.size.height * 0.5) / currentZoom
  );
  CGFloat zoom = MIN(BsnPdfMaxZoom, MAX(BsnPdfMinZoom, self.scrollView.zoomScale));
  if (snap && zoom <= 1.02) {
    zoom = BsnPdfMinZoom;
    [self.scrollView setZoomScale:zoom animated:NO];
    [self resetHiResOverlayState];
    BOOL hasFocus = isfinite(contentPoint.x) && isfinite(contentPoint.y);
    currentOffset = hasFocus
      ? CGPointMake(contentPoint.x * zoom - viewPoint.x, contentPoint.y * zoom - viewPoint.y)
      : CGPointMake(
        centerContentPoint.x * zoom - self.bounds.size.width * 0.5,
        centerContentPoint.y * zoom - self.bounds.size.height * 0.5
      );
  }
  CGFloat maxOffsetX = MAX(0, self.scrollView.contentSize.width - self.bounds.size.width);
  CGFloat maxOffsetY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
  CGPoint offset = snap && zoom <= BsnPdfMinZoom + 0.0001 ? currentOffset : self.scrollView.contentOffset;
  if (zoom <= BsnPdfMinZoom + 0.0001) offset.x = 0;
  self.scrollView.contentOffset = CGPointMake(
    MIN(MAX(0, offset.x), maxOffsetX),
    MIN(MAX(0, offset.y), maxOffsetY)
  );
}

- (void)handleViewportPan:(UIPanGestureRecognizer *)gesture
{
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0 || self.layouts.count == 0) return;
  if (gesture.state == UIGestureRecognizerStateBegan) {
    [self stopInertia];
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(startHiResOverlayRender) object:nil];
    self.viewportPanActive = YES;
    self.lastContentOffsetY = self.scrollView.contentOffset.y;
  } else if (gesture.state == UIGestureRecognizerStateChanged) {
    CGPoint translation = [gesture translationInView:self];
    if (self.customViewportCoreEnabled) {
      CGFloat previousY = self.coreScrollYDocument;
      CGFloat zoom = MAX(0.0001, self.coreScale);
      self.coreTranslateX += translation.x;
      self.coreScrollYDocument -= translation.y / zoom;
      [gesture setTranslation:CGPointZero inView:self];
      [self applyCustomViewportDidChangeWithDeltaY:self.coreScrollYDocument - previousY force:NO];
      return;
    }
    CGFloat previousY = self.scrollView.contentOffset.y;
    self.scrollView.contentOffset = CGPointMake(
      self.scrollView.contentOffset.x - translation.x,
      self.scrollView.contentOffset.y - translation.y
    );
    [gesture setTranslation:CGPointZero inView:self];
    [self clampViewportOffsetSnap:NO];
    CGFloat zoom = MAX(0.0001, self.scrollView.zoomScale);
    [self updateBaseRenderDirection:(self.scrollView.contentOffset.y - previousY) / zoom];
    self.lastContentOffsetY = self.scrollView.contentOffset.y;
    [self scheduleBaseRendersForce:NO];
    [self emitPageChangedIfNeededFromSource:@"viewportPan"];
    [self saveViewportAnchor];
    [self requestViewportChangedForce:NO];
  } else if (gesture.state == UIGestureRecognizerStateEnded) {
    self.viewportPanActive = NO;
    CGPoint velocity = [gesture velocityInView:self];
    [self startInertiaWithVelocity:CGPointMake(-velocity.x, -velocity.y)];
  } else if (gesture.state == UIGestureRecognizerStateCancelled || gesture.state == UIGestureRecognizerStateFailed) {
    self.viewportPanActive = NO;
    [self resetBaseRenderDirection];
    [self scheduleBaseRendersForce:YES];
    [self requestHiResOverlayAfterDelay:160];
    [self flushDeferredViewportInvalidations];
  }
}

- (void)handleSelectionPan:(UIPanGestureRecognizer *)gesture
{
  if (![self.inkTool isEqualToString:@"select"] || !self.selectionGestureEnabled) return;
  if (gesture.state == UIGestureRecognizerStateBegan) {
    [self stopViewportMotionAndSettle];
    self.activeSelectionAction = nil;
    self.activeSelectionResizeCorner = nil;
    [self emitSelectionGesture:gesture phase:@"begin"];
  } else if (gesture.state == UIGestureRecognizerStateChanged) {
    [self emitSelectionGesture:gesture phase:@"move"];
  } else if (gesture.state == UIGestureRecognizerStateEnded) {
    [self emitSelectionGesture:gesture phase:@"end"];
    self.activeSelectionAction = nil;
    self.activeSelectionResizeCorner = nil;
  } else if (gesture.state == UIGestureRecognizerStateCancelled || gesture.state == UIGestureRecognizerStateFailed) {
    [self emitSelectionGesture:gesture phase:@"cancel"];
    self.activeSelectionAction = nil;
    self.activeSelectionResizeCorner = nil;
  }
}

- (void)handleSelectionTap:(UITapGestureRecognizer *)gesture
{
  if (gesture.state != UIGestureRecognizerStateEnded) return;
  if (![self.inkTool isEqualToString:@"select"] || !self.selectionGestureEnabled || !self.selectionMenuEnabled) return;
  NSDictionary *actionPayload = [self selectionMenuActionAtViewPoint:[gesture locationInView:self]];
  if (actionPayload == nil) return;
  NSString *action = [RCTConvert NSString:actionPayload[@"action"]];
  if ([action isEqualToString:@"noop"]) return;
  if ([action isEqualToString:@"palette"]) {
    [self setSelectionOverlayNeedsDisplay];
    self.selectionColorPickerOpen = !self.selectionColorPickerOpen;
    [self setSelectionOverlayNeedsDisplay];
    return;
  }
  if (self.onSelectionAction != nil) {
    self.onSelectionAction(@{
      @"action": action ?: @"askAi",
      @"color": actionPayload[@"color"] ?: (id)kCFNull,
      @"pageId": actionPayload[@"pageId"] ?: @"page",
    });
  }
  if ([action isEqualToString:@"color"]) {
    [self setSelectionOverlayNeedsDisplay];
    self.selectionColorPickerOpen = NO;
    [self setSelectionOverlayNeedsDisplay];
  }
}

- (void)handleTextTap:(UITapGestureRecognizer *)gesture
{
  if (gesture.state != UIGestureRecognizerStateEnded) return;
  if (![self.inkTool isEqualToString:@"text"] || !self.textGestureEnabled) return;
  if (self.activeTextAnnotationId.length > 0) {
    [self deactivateActiveTextAnnotationCommit:YES];
    return;
  }
  NSDictionary *hit = [self hitPagePointAtViewPoint:[gesture locationInView:self]];
  NSDictionary *point = hit[@"point"];
  if (point == nil || self.onTextAnnotationAdd == nil) return;
  [self stopViewportMotionAndSettle];
  self.suppressInkViewportEventsUntil = CACurrentMediaTime() + 0.25;
  self.onTextAnnotationAdd(point);
}

- (void)emitSelectionGesture:(UIPanGestureRecognizer *)gesture phase:(NSString *)phase
{
  if (self.onSelectionGesture == nil) return;
  CGPoint viewPoint = [gesture locationInView:self];
  NSDictionary *hit = [self hitPagePointAtViewPoint:viewPoint];
  BsnPdfPageLayout *layout = hit[@"layout"];
  NSDictionary *point = hit[@"point"];
  if (layout == nil || point == nil) return;

  NSString *corner = nil;
  NSString *action = self.activeSelectionAction;
  if ([phase isEqualToString:@"begin"]) {
    action = [self selectionActionForPoint:point resizeCorner:&corner];
    self.activeSelectionAction = action;
    self.activeSelectionResizeCorner = corner;
  } else {
    corner = self.activeSelectionResizeCorner;
  }

  self.onSelectionGesture(@{
    @"phase": phase ?: @"move",
    @"action": action ?: @"new",
    @"resizeCorner": corner ?: (id)kCFNull,
    @"pageId": layout.pageId ?: @"page",
    @"kind": layout.kind ?: @"pdf",
    @"label": layout.label ?: @"Page",
    @"pageNumber": layout.pageNumber ?: (id)kCFNull,
    @"generatedPageId": layout.generatedPageId ?: (id)kCFNull,
    @"x": point[@"x"] ?: @0,
    @"y": point[@"y"] ?: @0,
    @"pageWidth": point[@"pageWidth"] ?: @(layout.logicalSize.width),
    @"pageHeight": point[@"pageHeight"] ?: @(layout.logicalSize.height),
  });
}

- (NSString *)selectionActionForPoint:(NSDictionary *)point resizeCorner:(NSString * __autoreleasing *)resizeCorner
{
  if (self.selectionOverlayWidth <= 0 || self.selectionOverlayHeight <= 0) return @"new";
  NSString *generatedId = [RCTConvert NSString:point[@"generatedPageId"]];
  NSNumber *pageNumber = point[@"pageNumber"] != nil ? [RCTConvert NSNumber:point[@"pageNumber"]] : nil;
  if (self.selectionOverlayGeneratedPageId.length > 0) {
    if (![generatedId isEqualToString:self.selectionOverlayGeneratedPageId]) return @"new";
  } else if (self.selectionOverlayPageNumber > 0) {
    if (pageNumber == nil || pageNumber.integerValue != self.selectionOverlayPageNumber) return @"new";
  }
  CGFloat pageWidth = MAX(1.0, self.selectionOverlayPageWidth);
  CGFloat pageHeight = MAX(1.0, self.selectionOverlayPageHeight);
  CGFloat x = [point[@"x"] doubleValue];
  CGFloat y = [point[@"y"] doubleValue];
  CGFloat left = self.selectionOverlayX;
  CGFloat top = self.selectionOverlayY;
  CGFloat right = self.selectionOverlayX + self.selectionOverlayWidth;
  CGFloat bottom = self.selectionOverlayY + self.selectionOverlayHeight;
  if ([self.selectionMode isEqualToString:@"lasso"] || [self.selectionOverlayMode isEqualToString:@"lasso"]) {
    CGFloat padded = MAX(10.0, MIN(pageWidth, pageHeight) * 0.008);
    if (x >= left - padded && x <= right + padded && y >= top - padded && y <= bottom + padded) return @"move";
    return @"new";
  }
  CGFloat handleRadius = MAX(18.0, MIN(pageWidth, pageHeight) * 0.015);
  NSArray<NSDictionary *> *handles = @[
    @{@"corner": @"nw", @"x": @(left), @"y": @(top)},
    @{@"corner": @"ne", @"x": @(right), @"y": @(top)},
    @{@"corner": @"sw", @"x": @(left), @"y": @(bottom)},
    @{@"corner": @"se", @"x": @(right), @"y": @(bottom)},
  ];
  for (NSDictionary *handle in handles) {
    CGFloat dx = x - [handle[@"x"] doubleValue];
    CGFloat dy = y - [handle[@"y"] doubleValue];
    if (hypot(dx, dy) <= handleRadius) {
      if (resizeCorner != nil) *resizeCorner = handle[@"corner"];
      return @"resize";
    }
  }
  if (x >= left && x <= right && y >= top && y <= bottom) return @"move";
  return @"new";
}

- (void)handleViewportPinch:(UIPinchGestureRecognizer *)gesture
{
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0 || self.layouts.count == 0) return;
  CGPoint focus = [gesture locationInView:self];
  if (gesture.state == UIGestureRecognizerStateBegan) {
    [self stopInertia];
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(startHiResOverlayRender) object:nil];
    self.viewportPinchActive = YES;
    self.pinchStartZoom = self.customViewportCoreEnabled ? MAX(0.0001, self.coreScale) : MAX(0.0001, self.scrollView.zoomScale);
    self.pinchLastFocusViewPoint = focus;
    self.pinchFocusAnchor = self.customViewportCoreEnabled ? [self captureCustomViewportAnchorAtViewPoint:focus] : nil;
    CGPoint rawFocusContentPoint = self.customViewportCoreEnabled
      ? [self contentPointForViewportPoint:focus]
      : CGPointMake(
        (focus.x + self.scrollView.contentOffset.x) / self.pinchStartZoom,
        (focus.y + self.scrollView.contentOffset.y) / self.pinchStartZoom
      );
    self.pinchFocusContentPoint = self.pinchFocusAnchor != nil
      ? [self contentPointForCustomViewportAnchor:self.pinchFocusAnchor fallbackContentPoint:rawFocusContentPoint]
      : rawFocusContentPoint;
    NSInteger focusPage = [self pageNumberNearContentPoint:self.pinchFocusContentPoint];
    if (focusPage > 0) {
      self.protectedPageNumber = focusPage;
      _requestedPage = focusPage;
    }
    if (self.customViewportCoreEnabled) {
      BsnPdfRenderDebugLog(self,
        @"[BsnPdfViewport][custom-core] pinch-begin focusDoc=(%.1f,%.1f) focusView=(%.1f,%.1f) scale=%.3f scrollY=%.1f translateX=%.1f page=%ld",
        self.pinchFocusContentPoint.x,
        self.pinchFocusContentPoint.y,
        focus.x,
        focus.y,
        self.coreScale,
        self.coreScrollYDocument,
        self.coreTranslateX,
        (long)focusPage);
    }
  } else if (gesture.state == UIGestureRecognizerStateChanged) {
    CGFloat nextZoom = MIN(BsnPdfMaxZoom, MAX(BsnPdfMinZoom, self.pinchStartZoom * gesture.scale));
    self.pinchLastFocusViewPoint = focus;
    if (self.customViewportCoreEnabled) {
      CGFloat previousY = self.coreScrollYDocument;
      CGPoint focusContentPoint = self.pinchFocusAnchor != nil
        ? [self contentPointForCustomViewportAnchor:self.pinchFocusAnchor fallbackContentPoint:self.pinchFocusContentPoint]
        : self.pinchFocusContentPoint;
      self.pinchFocusContentPoint = focusContentPoint;
      self.coreScale = nextZoom;
      [self clampCustomViewportSnap:NO preservingContentPoint:focusContentPoint atViewPoint:focus];
      [self applyCustomViewportDidChangeWithDeltaY:self.coreScrollYDocument - previousY force:NO];
      NSInteger focusPage = [self pageNumberNearContentPoint:focusContentPoint];
      if (focusPage > 0) {
        self.protectedPageNumber = focusPage;
        _requestedPage = focusPage;
      }
      return;
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    [UIView performWithoutAnimation:^{
      [self.scrollView setZoomScale:nextZoom animated:NO];
      self.scrollView.contentOffset = CGPointMake(
        self.pinchFocusContentPoint.x * nextZoom - focus.x,
        self.pinchFocusContentPoint.y * nextZoom - focus.y
      );
    }];
    [CATransaction commit];
    [self clampViewportOffsetSnap:NO];
    self.lastContentOffsetY = self.scrollView.contentOffset.y;
    NSInteger focusPage = [self pageNumberNearContentPoint:self.pinchFocusContentPoint];
    if (focusPage > 0) {
      self.protectedPageNumber = focusPage;
      _requestedPage = focusPage;
    }
    [self requestViewportChangedForce:NO];
  } else if (gesture.state == UIGestureRecognizerStateEnded) {
    self.pinchLastFocusViewPoint = focus;
    if (self.customViewportCoreEnabled) {
      CGPoint focusContentPoint = self.pinchFocusAnchor != nil
        ? [self contentPointForCustomViewportAnchor:self.pinchFocusAnchor fallbackContentPoint:self.pinchFocusContentPoint]
        : self.pinchFocusContentPoint;
      self.pinchFocusContentPoint = focusContentPoint;
      [self clampCustomViewportSnap:YES preservingContentPoint:focusContentPoint atViewPoint:self.pinchLastFocusViewPoint];
      [self syncScrollViewFromCustomCore];
      NSInteger focusPage = [self pageNumberNearContentPoint:focusContentPoint];
      if (focusPage > 0) {
        self.protectedPageNumber = focusPage;
        _requestedPage = focusPage;
      }
      self.viewportPinchActive = NO;
      self.pinchFocusAnchor = nil;
      [self invalidateCustomViewportSurfaces];
      [self saveViewportAnchor];
      [self flushDeferredViewportInvalidations];
      [self scheduleBaseRendersForce:YES];
      [self requestHiResOverlayAfterDelay:180];
      [self requestViewportChangedForce:YES];
      return;
    }
    [self clampViewportOffsetSnap:YES preservingContentPoint:self.pinchFocusContentPoint atViewPoint:self.pinchLastFocusViewPoint];
    NSInteger focusPage = [self pageNumberNearContentPoint:self.pinchFocusContentPoint];
    if (focusPage > 0) {
      self.protectedPageNumber = focusPage;
      _requestedPage = focusPage;
    }
    self.viewportPinchActive = NO;
    self.lastContentOffsetY = self.scrollView.contentOffset.y;
    [self saveViewportAnchor];
    [self flushDeferredViewportInvalidations];
    [self scheduleBaseRendersForce:YES];
    [self requestHiResOverlayAfterDelay:180];
    [self requestViewportChangedForce:YES];
  } else if (gesture.state == UIGestureRecognizerStateCancelled || gesture.state == UIGestureRecognizerStateFailed) {
    if (self.customViewportCoreEnabled) {
      CGPoint focusContentPoint = self.pinchFocusAnchor != nil
        ? [self contentPointForCustomViewportAnchor:self.pinchFocusAnchor fallbackContentPoint:self.pinchFocusContentPoint]
        : self.pinchFocusContentPoint;
      self.pinchFocusContentPoint = focusContentPoint;
      [self clampCustomViewportSnap:YES preservingContentPoint:focusContentPoint atViewPoint:self.pinchLastFocusViewPoint];
      [self syncScrollViewFromCustomCore];
      self.viewportPinchActive = NO;
      self.pinchFocusAnchor = nil;
      [self invalidateCustomViewportSurfaces];
      [self saveViewportAnchor];
      [self flushDeferredViewportInvalidations];
      [self requestHiResOverlayAfterDelay:180];
      [self requestViewportChangedForce:YES];
      return;
    }
    [self clampViewportOffsetSnap:YES preservingContentPoint:self.pinchFocusContentPoint atViewPoint:self.pinchLastFocusViewPoint];
    NSInteger focusPage = [self pageNumberNearContentPoint:self.pinchFocusContentPoint];
    if (focusPage > 0) {
      self.protectedPageNumber = focusPage;
      _requestedPage = focusPage;
    }
    self.viewportPinchActive = NO;
    self.lastContentOffsetY = self.scrollView.contentOffset.y;
    [self saveViewportAnchor];
    [self flushDeferredViewportInvalidations];
    [self requestHiResOverlayAfterDelay:180];
  }
}

- (void)startInertiaWithVelocity:(CGPoint)velocity
{
  CGFloat threshold = 650.0;
  CGFloat maxVelocity = 10600.0;
  velocity.x = MIN(MAX(velocity.x, -maxVelocity), maxVelocity);
  velocity.y = MIN(MAX(velocity.y, -maxVelocity), maxVelocity);
  if (hypot(velocity.x, velocity.y) < threshold) {
    [self resetBaseRenderDirection];
    [self scheduleBaseRendersForce:YES];
    [self requestHiResOverlayAfterDelay:160];
    [self flushDeferredViewportInvalidations];
    return;
  }
  self.inertiaVelocity = velocity;
  self.inertiaLastTimestamp = CACurrentMediaTime();
  [self.inertiaDisplayLink invalidate];
  self.inertiaDisplayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(stepInertia:)];
  [self.inertiaDisplayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)stepInertia:(CADisplayLink *)displayLink
{
  CFTimeInterval now = CACurrentMediaTime();
  CGFloat dt = self.inertiaLastTimestamp > 0 ? MIN(MAX(now - self.inertiaLastTimestamp, 0.001), 0.034) : 0.016;
  self.inertiaLastTimestamp = now;
  if (self.customViewportCoreEnabled) {
    CGFloat previousY = self.coreScrollYDocument;
    CGFloat zoom = MAX(0.0001, self.coreScale);
    self.coreTranslateX -= self.inertiaVelocity.x * dt;
    self.coreScrollYDocument += self.inertiaVelocity.y * dt / zoom;
    [self clampCustomViewportSnap:NO];
    CGFloat maxOffsetX = MAX(0, self.coreContentWidth * zoom - self.bounds.size.width);
    CGFloat maxScrollY = MAX(0, self.coreContentHeight - self.bounds.size.height / zoom);
    CGFloat offsetX = -self.coreTranslateX;
    if ((offsetX <= 0 && self.inertiaVelocity.x < 0) || (offsetX >= maxOffsetX && self.inertiaVelocity.x > 0)) {
      self.inertiaVelocity = CGPointMake(0, self.inertiaVelocity.y);
    }
    if ((self.coreScrollYDocument <= 0 && self.inertiaVelocity.y < 0) || (self.coreScrollYDocument >= maxScrollY && self.inertiaVelocity.y > 0)) {
      self.inertiaVelocity = CGPointMake(self.inertiaVelocity.x, 0);
    }
    CGFloat decay = exp(-2.2 * dt);
    self.inertiaVelocity = CGPointMake(self.inertiaVelocity.x * decay, self.inertiaVelocity.y * decay);
    [self applyCustomViewportDidChangeWithDeltaY:self.coreScrollYDocument - previousY force:NO];

    if (hypot(self.inertiaVelocity.x, self.inertiaVelocity.y) <= 100.0) {
      [self stopInertia];
      [self resetBaseRenderDirection];
      [self scheduleBaseRendersForce:YES];
      [self requestHiResOverlayAfterDelay:160];
      [self flushDeferredViewportInvalidations];
    }
    return;
  }
  CGPoint previousOffset = self.scrollView.contentOffset;
  self.scrollView.contentOffset = CGPointMake(
    self.scrollView.contentOffset.x + self.inertiaVelocity.x * dt,
    self.scrollView.contentOffset.y + self.inertiaVelocity.y * dt
  );
  [self clampViewportOffsetSnap:NO];
  CGFloat maxOffsetX = MAX(0, self.scrollView.contentSize.width - self.bounds.size.width);
  CGFloat maxOffsetY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
  if ((self.scrollView.contentOffset.x <= 0 && self.inertiaVelocity.x < 0)
    || (self.scrollView.contentOffset.x >= maxOffsetX && self.inertiaVelocity.x > 0)) {
    self.inertiaVelocity = CGPointMake(0, self.inertiaVelocity.y);
  }
  if ((self.scrollView.contentOffset.y <= 0 && self.inertiaVelocity.y < 0)
    || (self.scrollView.contentOffset.y >= maxOffsetY && self.inertiaVelocity.y > 0)) {
    self.inertiaVelocity = CGPointMake(self.inertiaVelocity.x, 0);
  }
  CGFloat decay = exp(-2.2 * dt);
  self.inertiaVelocity = CGPointMake(self.inertiaVelocity.x * decay, self.inertiaVelocity.y * decay);
  CGFloat zoom = MAX(1.0, self.scrollView.zoomScale);
  [self updateBaseRenderDirection:(self.scrollView.contentOffset.y - previousOffset.y) / zoom];
  [self scheduleBaseRendersForce:NO];
  [self emitPageChangedIfNeededFromSource:@"viewportInertia"];
  [self saveViewportAnchor];
  [self requestViewportChangedForce:NO];

  if (hypot(self.inertiaVelocity.x, self.inertiaVelocity.y) <= 100.0) {
    [self stopInertia];
    [self resetBaseRenderDirection];
    [self scheduleBaseRendersForce:YES];
    [self requestHiResOverlayAfterDelay:160];
    [self flushDeferredViewportInvalidations];
  }
}

- (void)stopInertia
{
  [self.inertiaDisplayLink invalidate];
  self.inertiaDisplayLink = nil;
  self.inertiaVelocity = CGPointZero;
  self.inertiaLastTimestamp = 0;
}

- (BOOL)isViewportMotionActive
{
  return self.viewportPinchActive
    || self.viewportPanActive
    || self.inertiaDisplayLink != nil
    || hypot(self.inertiaVelocity.x, self.inertiaVelocity.y) > 0.5;
}

- (BOOL)isViewportUserInteractionActive
{
  return self.scrollView.isTracking
    || self.scrollView.isDragging
    || self.scrollView.isDecelerating
    || [self isViewportMotionActive];
}

- (BOOL)isCustomViewportDrivingScroll
{
  return self.syncingCustomViewportToScrollView
    || self.viewportPanActive
    || self.viewportPinchActive
    || self.inertiaDisplayLink != nil;
}

- (void)flushDeferredViewportInvalidations
{
  if (self.inkInteractionActive || [self isViewportMotionActive]) return;
  [self flushDeferredContentInvalidation];
  [self flushDeferredEditOverlayInvalidation];
}

- (void)interruptViewportMotionForUserTouch
{
  [self stopViewportMotionAndSettle];
}

- (void)stopViewportMotionAndSettle
{
  BOOL wasMoving = self.inertiaDisplayLink != nil
    || hypot(self.inertiaVelocity.x, self.inertiaVelocity.y) > 0.5
    || self.scrollView.decelerating;
  [self stopInertia];

  CGPoint currentOffset = self.scrollView.contentOffset;
  [self.scrollView.layer removeAllAnimations];
  [self.scrollView setContentOffset:currentOffset animated:NO];
  self.lastContentOffsetY = self.scrollView.contentOffset.y;

  if (!wasMoving) return;
  self.viewportPanActive = NO;
  [self resetBaseRenderDirection];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:160];
  [self saveViewportAnchor];
  [self flushDeferredViewportInvalidations];
  [self requestViewportChangedForce:NO];
}

- (NSInteger)baseRenderTargetWidth
{
  CGFloat screenScale = UIScreen.mainScreen.scale;
  return [self quantizedRenderTargetWidth:MIN(BsnPdfMaxBaseRenderTargetWidth, (NSInteger)llround(self.bounds.size.width * screenScale))];
}

- (NSInteger)quantizedRenderTargetWidth:(NSInteger)targetWidth
{
  NSInteger clamped = MAX(1, MIN(BsnPdfMaxHiResRenderTargetWidth, targetWidth));
  if (clamped <= BsnPdfRenderTargetWidthQuantum) return clamped;
  NSInteger quantum = BsnPdfRenderTargetWidthQuantum;
  return MAX(quantum, MIN(BsnPdfMaxHiResRenderTargetWidth, ((clamped + quantum - 1) / quantum) * quantum));
}

- (NSString *)baseCacheKeyForPageNumber:(NSInteger)pageNumber targetWidth:(NSInteger)targetWidth
{
  return [NSString stringWithFormat:@"%@:%ld:%ld", self.fileUri ?: @"", (long)pageNumber, (long)targetWidth];
}

- (nullable UIImage *)baseImageForPageNumber:(NSInteger)pageNumber
{
  UIImage *image = [self.baseBitmapCache objectForKey:[self baseCacheKeyForPageNumber:pageNumber targetWidth:[self baseRenderTargetWidth]]];
  if (image == nil) {
    image = self.latestBaseImageByPageNumber[@(pageNumber)];
  }
  if (image != nil) {
    self.baseCacheHits += 1;
  } else {
    self.baseCacheMisses += 1;
  }
  [self logPerfMetricsIfNeededWithReason:@"baseImage"];
  return image;
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
  NSString *scheduleKey = [NSString stringWithFormat:@"%ld:%ld:%ld:%ld:%@", (long)self.renderGeneration, (long)targetWidth, (long)centerIndex, (long)self.baseRenderDirection, [scheduleParts componentsJoinedByString:@","]];
  if (!force && [scheduleKey isEqualToString:self.lastBaseRenderScheduleKey]) return;
  self.lastBaseRenderScheduleKey = scheduleKey;
  @synchronized (self) {
    self.wantedBaseRenderKeys = wantedKeys;
    [self.baseRenderRequests intersectSet:wantedKeys];
    [self.startedBaseRenderKeys intersectSet:wantedKeys];
  }
  [self pruneBaseRenderQueueForWantedKeys:wantedKeys];
  [indexes enumerateObjectsUsingBlock:^(NSNumber *indexNumber, NSUInteger priority, BOOL *stop) {
    BsnPdfPageLayout *layout = self.layouts[indexNumber.integerValue];
    [self requestBaseRenderForLayout:layout priority:(NSInteger)priority];
  }];
}

- (void)pruneBaseRenderQueueForWantedKeys:(NSSet<NSString *> *)wantedKeys
{
  for (NSOperation *operation in self.baseRenderQueue.operations) {
    NSString *key = operation.name;
    if (key.length > 0 && ![wantedKeys containsObject:key]) {
      [operation cancel];
    }
  }
}

- (NSInteger)centerLayoutIndex
{
  CGFloat zoom = MAX(0.0001, [self viewportScale]);
  CGPoint offset = [self viewportContentOffset];
  CGFloat centerY = (offset.y + self.bounds.size.height * 0.5) / zoom;
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
  for (NSNumber *visibleIndex in [self visibleRenderPriorityIndexes]) {
    addIndex(visibleIndex.integerValue);
  }
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

- (NSArray<NSNumber *> *)visibleRenderPriorityIndexes
{
  if (self.layouts.count == 0 || self.bounds.size.width <= 0 || self.bounds.size.height <= 0) return @[];
  CGFloat zoom = MAX(0.0001, [self viewportScale]);
  CGPoint offset = [self viewportContentOffset];
  CGRect viewport = CGRectMake(
    offset.x / zoom,
    offset.y / zoom,
    self.bounds.size.width / zoom,
    self.bounds.size.height / zoom
  );
  CGRect priorityViewport = CGRectInset(viewport, 0, -CGRectGetHeight(viewport) * 0.2);
  CGPoint viewportCenter = CGPointMake(CGRectGetMidX(viewport), CGRectGetMidY(viewport));
  NSMutableArray<NSDictionary *> *entries = [NSMutableArray array];
  for (NSInteger index = 0; index < self.layouts.count; index += 1) {
    BsnPdfPageLayout *layout = self.layouts[index];
    if (layout.pageNumber == nil || !CGRectIntersectsRect(priorityViewport, layout.frame)) continue;
    CGRect overlap = CGRectIntersection(priorityViewport, layout.frame);
    CGFloat overlapArea = MAX(0, overlap.size.width) * MAX(0, overlap.size.height);
    CGFloat distance = hypot(CGRectGetMidX(layout.frame) - viewportCenter.x, CGRectGetMidY(layout.frame) - viewportCenter.y);
    [entries addObject:@{@"index": @(index), @"overlap": @(overlapArea), @"distance": @(distance)}];
  }
  [entries sortUsingComparator:^NSComparisonResult(NSDictionary *first, NSDictionary *second) {
    NSComparisonResult overlapResult = [second[@"overlap"] compare:first[@"overlap"]];
    if (overlapResult != NSOrderedSame) return overlapResult;
    return [first[@"distance"] compare:second[@"distance"]];
  }];
  NSMutableArray<NSNumber *> *indexes = [NSMutableArray array];
  for (NSDictionary *entry in entries) [indexes addObject:entry[@"index"]];
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
  __block NSBlockOperation *operation = nil;
  operation = [NSBlockOperation blockOperationWithBlock:^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (strongSelf == nil) return;
    if (operation.isCancelled) return;
    @synchronized (strongSelf) {
      [strongSelf.baseRenderRequests removeObject:key];
      if (![strongSelf.wantedBaseRenderKeys containsObject:key]) return;
      if ([strongSelf.startedBaseRenderKeys containsObject:key]) return;
      [strongSelf.startedBaseRenderKeys addObject:key];
    }
    if (operation.isCancelled) {
      @synchronized (strongSelf) {
        [strongSelf.startedBaseRenderKeys removeObject:key];
      }
      return;
    }
    UIImage *image = [strongSelf renderBasePageNumber:pageNumber targetWidth:targetWidth fileURL:fileURL];
    if (operation.isCancelled) image = nil;
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
      currentSelf.latestBaseImageByPageNumber[@(pageNumber)] = image;
      currentSelf.baseRenderCompletedCount += 1;
      [currentSelf logPerfMetricsIfNeededWithReason:@"baseRender"];
      [currentSelf logRenderDebugEvent:@"render" target:@"base" action:@"complete" rect:[currentSelf contentRectForPageNumber:pageNumber] extra:[NSString stringWithFormat:@"page=%ld targetWidth=%ld", (long)pageNumber, (long)targetWidth]];
      [currentSelf setContentNeedsDisplayForPageNumber:pageNumber];
    }];
  }];
  if (priority == 0) {
    operation.queuePriority = NSOperationQueuePriorityVeryHigh;
  } else if (priority <= 2) {
    operation.queuePriority = NSOperationQueuePriorityHigh;
  } else {
    operation.queuePriority = NSOperationQueuePriorityNormal;
  }
  operation.name = key;
  [self.baseRenderQueue addOperation:operation];
}

- (nullable UIImage *)renderBasePageNumber:(NSInteger)pageNumber targetWidth:(NSInteger)targetWidth fileURL:(NSURL *)fileURL
{
  PDFDocument *document = nil;
  @try {
    document = [[PDFDocument alloc] initWithURL:fileURL];
  } @catch (NSException *exception) {
    document = nil;
  }
  if (document == nil || pageNumber < 1 || pageNumber > document.pageCount) return nil;
  PDFPage *page = nil;
  @try {
    page = [document pageAtIndex:pageNumber - 1];
  } @catch (NSException *exception) {
    page = nil;
  }
  if (page == nil) return nil;
  PDFDisplayBox box = kPDFDisplayBoxCropBox;
  CGRect pageBounds = [self safeBoundsForPage:page displayBox:&box];
  if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) return nil;
  targetWidth = [self quantizedRenderTargetWidth:targetWidth];
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
    @try {
      [page drawWithBox:box toContext:context];
    } @catch (NSException *exception) {
    }
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
  [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"schedule" rect:self.bounds extra:[NSString stringWithFormat:@"delayMs=%.0f", delayMs]];
  if (delayMs <= 0) {
    [self startHiResOverlayRender];
  } else {
    [self performSelector:@selector(startHiResOverlayRender) withObject:nil afterDelay:delayMs / 1000.0];
  }
}

- (void)startHiResOverlayRender
{
  if ([self isViewportMotionActive]) {
    [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"skip-motion" rect:self.bounds extra:@""];
    return;
  }
  if (self.scrollView.zoomScale < BsnPdfHiResMinZoom || self.bounds.size.width <= 0 || self.bounds.size.height <= 0) {
    [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"reset-low-zoom" rect:self.bounds extra:[NSString stringWithFormat:@"scale=%.2f", self.scrollView.zoomScale]];
    [self resetHiResOverlayState];
    return;
  }
  NSArray<BsnPdfHiResRequest *> *requests = [self buildVisibleHiResRequests];
  NSMutableSet<NSNumber *> *visiblePageNumbers = [NSMutableSet set];
  for (BsnPdfHiResRequest *request in requests) [visiblePageNumbers addObject:@(request.pageNumber)];
  [self discardInvisibleHiResOverlays:visiblePageNumbers];
  NSMutableSet<NSString *> *wantedHiResKeys = [NSMutableSet set];
  for (BsnPdfHiResRequest *request in requests) [wantedHiResKeys addObject:[self hiResRenderKeyForRequest:request]];
  [self pruneHiResRenderQueueForWantedKeys:wantedHiResKeys];
  if (requests.count == 0) {
    [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"no-requests" rect:self.bounds extra:@""];
    return;
  }
  NSURL *fileURL = [self fileURLFromString:self.fileUri];
  if (fileURL == nil) return;
  [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"start" rect:self.bounds extra:[NSString stringWithFormat:@"requests=%lu", (unsigned long)requests.count]];

  for (BsnPdfHiResRequest *request in requests) {
    BsnPdfHiResOverlay *current = self.hiResOverlays[@(request.pageNumber)];
    if (current != nil && current.request.targetWidth == request.targetWidth && [self hiResRequest:current.request containsRequest:request]) continue;
    BsnPdfHiResRequest *inFlight = self.hiResInFlight[@(request.pageNumber)];
    if (inFlight != nil && inFlight.targetWidth == request.targetWidth && [self hiResRequest:inFlight containsRequest:request]) continue;

    request.generation = self.hiResGeneration;
    NSString *requestKey = [self hiResRenderKeyForRequest:request];
    self.hiResInFlight[@(request.pageNumber)] = request;
    __weak typeof(self) weakSelf = self;
    __block NSBlockOperation *operation = nil;
    operation = [NSBlockOperation blockOperationWithBlock:^{
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (strongSelf == nil) return;
      UIImage *image = operation.isCancelled ? nil : [strongSelf renderRegionForRequest:request fileURL:fileURL];
      if (operation.isCancelled) image = nil;
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
        currentSelf.hiResRenderCompletedCount += 1;
        [currentSelf logPerfMetricsIfNeededWithReason:@"hiRes"];
        [currentSelf logRenderDebugEvent:@"render" target:@"hiRes" action:@"complete" rect:[currentSelf contentRectForHiResRequest:request] extra:[NSString stringWithFormat:@"page=%ld targetWidth=%ld", (long)request.pageNumber, (long)request.targetWidth]];
        [currentSelf setContentNeedsDisplayForHiResRequest:request];
      }];
    }];
    operation.name = requestKey;
    [self.hiResRenderQueue addOperation:operation];
  }
}

- (NSString *)hiResRenderKeyForRequest:(BsnPdfHiResRequest *)request
{
  return [NSString stringWithFormat:@"%ld:%ld:%.3f:%.3f:%.3f:%.3f",
    (long)request.pageNumber,
    (long)request.targetWidth,
    request.regionX,
    request.regionY,
    request.regionWidth,
    request.regionHeight];
}

- (void)pruneHiResRenderQueueForWantedKeys:(NSSet<NSString *> *)wantedKeys
{
  for (NSOperation *operation in self.hiResRenderQueue.operations) {
    NSString *key = operation.name;
    if (key.length > 0 && ![wantedKeys containsObject:key]) {
      [operation cancel];
    }
  }
}

- (NSArray<BsnPdfHiResRequest *> *)buildVisibleHiResRequests
{
  CGFloat zoom = MAX(0.0001, [self viewportScale]);
  CGPoint offset = [self viewportContentOffset];
  CGRect viewport = CGRectMake(offset.x / zoom, offset.y / zoom, self.bounds.size.width / zoom, self.bounds.size.height / zoom);
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
  request.targetWidth = [self quantizedRenderTargetWidth:MAX([self baseRenderTargetWidth], (NSInteger)llround(layout.frame.size.width * self.scrollView.zoomScale * UIScreen.mainScreen.scale))];
  request.regionX = [self quantize:paddedX];
  request.regionY = [self quantize:paddedY];
  request.regionWidth = [self quantize:paddedRight - paddedX];
  request.regionHeight = [self quantize:paddedBottom - paddedY];
  return request;
}

- (nullable UIImage *)renderRegionForRequest:(BsnPdfHiResRequest *)request fileURL:(NSURL *)fileURL
{
  PDFDocument *document = nil;
  @try {
    document = [[PDFDocument alloc] initWithURL:fileURL];
  } @catch (NSException *exception) {
    document = nil;
  }
  if (document == nil || request.pageNumber < 1 || request.pageNumber > document.pageCount) return nil;
  PDFPage *page = nil;
  @try {
    page = [document pageAtIndex:request.pageNumber - 1];
  } @catch (NSException *exception) {
    page = nil;
  }
  if (page == nil) return nil;
  PDFDisplayBox box = kPDFDisplayBoxCropBox;
  CGRect pageBounds = [self safeBoundsForPage:page displayBox:&box];
  if (CGRectIsEmpty(pageBounds) || pageBounds.size.width <= 0 || pageBounds.size.height <= 0) return nil;
  NSInteger fullWidth = MAX(1, [self quantizedRenderTargetWidth:request.targetWidth]);
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
    @try {
      [page drawWithBox:box toContext:context];
    } @catch (NSException *exception) {
    }
    CGContextRestoreGState(context);
  }];
}

- (void)drawHiResOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  if ([self isViewportMotionActive]) return;
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
  NSArray<BsnPdfHiResOverlay *> *overlays = self.hiResOverlays.allValues.copy;
  [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"reset" rect:self.bounds extra:[NSString stringWithFormat:@"overlays=%lu inFlight=%lu", (unsigned long)overlays.count, (unsigned long)self.hiResInFlight.count]];
  self.hiResGeneration += 1;
  [self.hiResRenderQueue cancelAllOperations];
  [self.hiResOverlays removeAllObjects];
  [self.hiResInFlight removeAllObjects];
  for (BsnPdfHiResOverlay *overlay in overlays) {
    [self setContentNeedsDisplayForHiResOverlay:overlay];
  }
}

- (void)discardInvisibleHiResOverlays:(NSSet<NSNumber *> *)visiblePageNumbers
{
  NSArray<NSNumber *> *keys = self.hiResOverlays.allKeys.copy;
  NSInteger discarded = 0;
  for (NSNumber *pageNumber in keys) {
    if (![visiblePageNumbers containsObject:pageNumber]) {
      BsnPdfHiResOverlay *overlay = self.hiResOverlays[pageNumber];
      [self.hiResOverlays removeObjectForKey:pageNumber];
      discarded += 1;
      if (overlay != nil) [self setContentNeedsDisplayForHiResOverlay:overlay];
    }
  }
  if (discarded > 0) [self logRenderDebugEvent:@"render" target:@"hiRes" action:@"discard-invisible" rect:self.bounds extra:[NSString stringWithFormat:@"count=%ld", (long)discarded]];
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
  NSInteger stablePage = [self stablePageForProgrammaticLayout];
  BOOL explicitRequest = self.requestedPageSerial > self.appliedRequestedPageSerial;
  if (
    !explicitRequest
    &&
    [self isSuppressingProgrammaticLayout]
    && self.hasAppliedInitialPage
    && stablePage > 1
    && self.requestedPage != stablePage
  ) {
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore scrollToRequestedPage layout-stale requested=%ld stable=%ld last=%ld reported=%ld offsetY=%.1f",
      (long)self.requestedPage,
      (long)stablePage,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      self.scrollView.contentOffset.y);
    _requestedPage = stablePage;
    self.pendingScrollToRequestedPage = NO;
    return;
  }
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
  CGFloat maxY = MAX(0, self.scrollView.contentSize.height - self.bounds.size.height);
  CGFloat targetY = MIN(MAX(0, y), maxY);
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] scrollToRequestedPage page=%ld beforeY=%.1f targetY=%.1f maxY=%.1f last=%ld reported=%ld",
    (long)self.requestedPage,
    self.scrollView.contentOffset.y,
    targetY,
    maxY,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber);
  [self stopInertia];
  [self.scrollView.layer removeAllAnimations];
  [self.scrollView setContentOffset:self.scrollView.contentOffset animated:NO];
  self.protectedPageNumber = self.requestedPage;
  self.suppressScrollPageEventsUntil = CACurrentMediaTime() + 0.9;
  self.suppressAnchorSaveUntil = MAX(self.suppressAnchorSaveUntil, CACurrentMediaTime() + 0.9);
  self.scrollView.contentOffset = CGPointMake(0, targetY);
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
  self.lastPageNumber = self.requestedPage;
  self.reportedPageNumber = self.requestedPage;
  if (explicitRequest) self.appliedRequestedPageSerial = self.requestedPageSerial;
  if (self.customViewportCoreEnabled) {
    [self syncCustomCoreFromScrollView];
    [self invalidateCustomViewportSurfaces];
  }
  [self saveViewportAnchor];
  [self setContentNeedsDisplaySafely];
  [self scheduleBaseRendersForce:YES];
  [self requestHiResOverlayAfterDelay:0];
  [self requestViewportChangedForce:YES];
}

- (void)emitPageChangedIfNeededFromSource:(NSString *)source
{
  if (self.inkInteractionActive || CACurrentMediaTime() < self.suppressInkViewportEventsUntil) return;
  NSString *pageChangeSource = source.length > 0 ? source : @"unknown";
  CGFloat zoom = MAX(0.0001, [self viewportScale]);
  CGPoint offset = [self viewportContentOffset];
  CGFloat centerY = (offset.y + self.bounds.size.height * 0.5) / zoom;
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
    BOOL protectedProgrammaticScroll = [pageChangeSource isEqualToString:@"scrollViewDidScroll"]
      && CACurrentMediaTime() < self.suppressScrollPageEventsUntil
      && self.protectedPageNumber > 0
      && pageNumber != self.protectedPageNumber
      && ![self isViewportUserInteractionActive];
    if (protectedProgrammaticScroll) {
      BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore pageCandidate source=%@ page=%ld previousLast=%ld protected=%ld reason=programmatic-scroll-settle offsetY=%.1f",
        pageChangeSource,
        (long)pageNumber,
        (long)self.lastPageNumber,
        (long)self.protectedPageNumber,
        self.scrollView.contentOffset.y);
      [self restoreProtectedPageAfterProgrammaticScrollCandidate:pageNumber source:pageChangeSource];
      return;
    }
    BOOL suppressingProgrammaticLayout = CACurrentMediaTime() < self.suppressAnchorSaveUntil
      && ![self isViewportUserInteractionActive];
    if (suppressingProgrammaticLayout && self.lastPageNumber > 0) {
      BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore pageCandidate source=%@ page=%ld previousLast=%ld reason=tool-layout offsetY=%.1f",
        pageChangeSource,
        (long)pageNumber,
        (long)self.lastPageNumber,
        self.scrollView.contentOffset.y);
      return;
    }
    if ([self restoreStablePageIfNeededForLayoutResetCandidate:pageNumber source:pageChangeSource]) return;
    BOOL isLayoutResetCandidate = [pageChangeSource isEqualToString:@"scrollViewDidScroll"]
      && suppressingProgrammaticLayout
      && pageNumber == 1
      && self.lastPageNumber > 1;
    if (isLayoutResetCandidate) {
      BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] ignore pageCandidate source=%@ page=%ld previousLast=%ld reason=layout-reset offsetY=%.1f",
        pageChangeSource,
        (long)pageNumber,
        (long)self.lastPageNumber,
        self.scrollView.contentOffset.y);
      return;
    }
    BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] pageCandidate source=%@ page=%ld previousLast=%ld reported=%ld requested=%ld offsetY=%.1f contentH=%.1f viewportH=%.1f centerY=%.1f",
      pageChangeSource,
      (long)pageNumber,
      (long)self.lastPageNumber,
      (long)self.reportedPageNumber,
      (long)self.requestedPage,
      self.scrollView.contentOffset.y,
      self.scrollView.contentSize.height,
      self.bounds.size.height,
      centerY);
    self.pendingPageChangeSource = pageChangeSource;
    self.lastPageNumber = pageNumber;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitPageChangedDebounced) object:nil];
    [self performSelector:@selector(emitPageChangedDebounced) withObject:nil afterDelay:0.12];
  }
}

- (void)emitPageChangedDebounced
{
  if (self.inkInteractionActive || CACurrentMediaTime() < self.suppressInkViewportEventsUntil) return;
  if (self.lastPageNumber <= 0 || self.lastPageNumber == self.reportedPageNumber) return;
  NSString *source = self.pendingPageChangeSource.length > 0 ? self.pendingPageChangeSource : @"unknown";
  BsnPdfPageDebugLog(@"[BsnPdfViewport][page-debug] emit onPageChanged source=%@ page=%ld reportedBefore=%ld requested=%ld offsetY=%.1f",
    source,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    (long)self.requestedPage,
    self.scrollView.contentOffset.y);
  self.reportedPageNumber = self.lastPageNumber;
  if (self.onPageChanged != nil) self.onPageChanged(@{@"pageNumber": @(self.lastPageNumber), @"source": source});
}

- (void)requestViewportChangedForce:(BOOL)force
{
  if (self.inkInteractionActive || CACurrentMediaTime() < self.suppressInkViewportEventsUntil) return;
  if (force) {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(emitViewportChangedThrottled) object:nil];
    self.viewportEventScheduled = NO;
    [self emitViewportChangedForce:YES];
    return;
  }
  if (self.viewportEventScheduled) return;
  self.viewportEventScheduled = YES;
  NSTimeInterval delay = [self isViewportMotionActive] ? 0.016 : 0.032;
  [self performSelector:@selector(emitViewportChangedThrottled) withObject:nil afterDelay:delay];
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
    @"pinching": @(self.viewportPinchActive),
    @"panning": @(self.viewportPanActive || self.inertiaDisplayLink != nil),
    @"restoring": @(self.restoringViewportAnchor || [self isSuppressingProgrammaticLayout] || self.deferredWidthLayoutPending),
    @"pages": pages,
  });
  [self logPerfMetricsIfNeededWithReason:@"viewport"];
}

- (void)logPerfMetricsIfNeededWithReason:(NSString *)reason
{
  if (!self.perfLoggingEnabled) return;
  CFTimeInterval now = CACurrentMediaTime();
  if (now - self.lastPerfLogTime < 1.0) return;
  self.lastPerfLogTime = now;
  NSInteger pendingBase = self.baseRenderQueue.operationCount;
  NSInteger pendingHiRes = self.hiResRenderQueue.operationCount;
  NSInteger requestedSerial = self.requestedPageSerial;
  NSInteger appliedSerial = self.appliedRequestedPageSerial;
  CGFloat offsetY = self.scrollView.contentOffset.y;
  CGFloat contentH = self.scrollView.contentSize.height;
  CGFloat viewportH = self.bounds.size.height;
  BsnPdfPerfLog(self,
    @"[BsnPdfViewport][perf] reason=%@ page=%ld reported=%ld requested=%ld serial=%ld/%ld offsetY=%.1f viewportH=%.1f contentH=%.1f baseCache=%ld/%ld baseDone=%ld hiResDone=%ld baseQueue=%ld hiResQueue=%ld scale=%.2f",
    reason ?: @"unknown",
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    (long)self.requestedPage,
    (long)appliedSerial,
    (long)requestedSerial,
    offsetY,
    viewportH,
    contentH,
    (long)self.baseCacheHits,
    (long)self.baseCacheMisses,
    (long)self.baseRenderCompletedCount,
    (long)self.hiResRenderCompletedCount,
    (long)pendingBase,
    (long)pendingHiRes,
    self.scrollView.zoomScale
  );
}

- (void)logRenderDebugEvent:(NSString *)event target:(NSString *)target action:(NSString *)action rect:(CGRect)rect extra:(NSString *)extra
{
  if (!self.renderDebugLoggingEnabled) return;
  NSString *safeEvent = event ?: @"unknown";
  NSString *safeTarget = target ?: @"unknown";
  NSString *safeAction = action ?: @"unknown";
  NSString *key = [NSString stringWithFormat:@"%@:%@:%@", safeEvent, safeTarget, safeAction];
  CFTimeInterval now = CACurrentMediaTime();
  NSNumber *last = self.renderDebugLastLogTimes[key];
  BOOL important = [safeEvent isEqualToString:@"layout"]
    || [safeTarget isEqualToString:@"hiRes"]
    || [safeTarget isEqualToString:@"base"]
    || [safeAction hasPrefix:@"flush"]
    || [safeAction hasPrefix:@"reset"]
    || [safeAction hasPrefix:@"complete"];
  if (!important && last != nil && now - last.doubleValue < 0.12) return;
  self.renderDebugLastLogTimes[key] = @(now);
  NSString *rectText = CGRectIsNull(rect) ? @"null" : NSStringFromCGRect(rect);
  NSInteger pendingBase = self.baseRenderQueue.operationCount;
  NSInteger pendingHiRes = self.hiResRenderQueue.operationCount;
  BsnPdfRenderDebugLog(self,
    @"[BsnPdfViewport][render-debug] event=%@ target=%@ action=%@ rect=%@ page=%ld reported=%ld requested=%ld offsetY=%.1f scale=%.2f moving=%@ ink=%@ deferredContent=%@ deferredEdit=%@ baseDone=%ld hiResDone=%ld baseQueue=%ld hiResQueue=%ld %@",
    safeEvent,
    safeTarget,
    safeAction,
    rectText,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    (long)self.requestedPage,
    self.scrollView.contentOffset.y,
    self.scrollView.zoomScale,
    [self isViewportMotionActive] ? @"YES" : @"NO",
    self.inkInteractionActive ? @"YES" : @"NO",
    self.deferredContentInvalidation ? @"YES" : @"NO",
    self.deferredEditOverlayInvalidation ? @"YES" : @"NO",
    (long)self.baseRenderCompletedCount,
    (long)self.hiResRenderCompletedCount,
    (long)pendingBase,
    (long)pendingHiRes,
    extra ?: @""
  );
}

- (void)logScrollDebugWithSource:(NSString *)source deltaY:(CGFloat)deltaY force:(BOOL)force
{
  if (!BsnPdfPageDebugLoggingEnabled) return;
  CFTimeInterval now = CACurrentMediaTime();
  if (!force && now - self.lastScrollDebugLogTime < 0.12) return;
  self.lastScrollDebugLogTime = now;
  CGFloat suppressAnchor = MAX(0, self.suppressAnchorSaveUntil - now);
  CGFloat suppressScroll = MAX(0, self.suppressScrollPageEventsUntil - now);
  BsnPdfPageDebugLog(
    @"[BsnPdfViewport][scroll-debug] source=%@ offsetY=%.1f deltaY=%.1f page=%ld reported=%ld requested=%ld serial=%ld/%ld scale=%.2f viewportH=%.1f contentH=%.1f tracking=%@ dragging=%@ decel=%@ restoring=%@ suppressAnchor=%.2f suppressScroll=%.2f protected=%ld",
    source ?: @"unknown",
    self.scrollView.contentOffset.y,
    deltaY,
    (long)self.lastPageNumber,
    (long)self.reportedPageNumber,
    (long)self.requestedPage,
    (long)self.appliedRequestedPageSerial,
    (long)self.requestedPageSerial,
    self.scrollView.zoomScale,
    self.bounds.size.height,
    self.scrollView.contentSize.height,
    self.scrollView.isTracking ? @"YES" : @"NO",
    self.scrollView.isDragging ? @"YES" : @"NO",
    self.scrollView.isDecelerating ? @"YES" : @"NO",
    self.restoringViewportAnchor ? @"YES" : @"NO",
    suppressAnchor,
    suppressScroll,
    (long)self.protectedPageNumber
  );
}

- (void)updateInkInputEnabled
{
  BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
  BOOL selectionTool = [self.inkTool isEqualToString:@"select"] && self.selectionGestureEnabled;
  BOOL textTool = [self.inkTool isEqualToString:@"text"] && self.textGestureEnabled;
  self.inkInputView.userInteractionEnabled = NO;
  self.fingerInkPanGesture.enabled = drawingTool && self.fingerDrawingEnabled;
  self.pencilInkPanGesture.enabled = drawingTool;
  self.selectionGesture.enabled = selectionTool;
  self.selectionTapGesture.enabled = selectionTool;
  self.textTapGesture.enabled = textTool;
  self.viewportPanGesture.enabled = YES;
  self.viewportPinchGesture.enabled = YES;
  self.scrollView.panGestureRecognizer.enabled = NO;
  self.scrollView.pinchGestureRecognizer.enabled = NO;
}

- (BOOL)shouldAcceptTouch:(UITouch *)touch
{
  if (self.fingerDrawingEnabled) return YES;
  if (@available(iOS 9.1, *)) {
    return touch.type == UITouchTypePencil;
  }
  return YES;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  if ((gestureRecognizer == self.viewportPanGesture && otherGestureRecognizer == self.viewportPinchGesture)
    || (gestureRecognizer == self.viewportPinchGesture && otherGestureRecognizer == self.viewportPanGesture)) {
    return YES;
  }
  return NO;
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gestureRecognizer
{
  if (gestureRecognizer == self.viewportPanGesture || gestureRecognizer == self.viewportPinchGesture) {
    return self.layouts.count > 0;
  }
  if (gestureRecognizer == self.selectionGesture) {
    return self.layouts.count > 0 && [self.inkTool isEqualToString:@"select"] && self.selectionGestureEnabled;
  }
  if (gestureRecognizer == self.selectionTapGesture) {
    return self.layouts.count > 0 && [self.inkTool isEqualToString:@"select"] && self.selectionGestureEnabled && self.selectionMenuEnabled;
  }
  if (gestureRecognizer == self.textTapGesture) {
    return self.layouts.count > 0 && [self.inkTool isEqualToString:@"text"] && self.textGestureEnabled;
  }
  if (gestureRecognizer == self.fingerInkPanGesture) {
    BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
    return drawingTool && self.fingerDrawingEnabled;
  }
  if (gestureRecognizer == self.pencilInkPanGesture) {
    BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
    return drawingTool;
  }
  return YES;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch
{
  if (gestureRecognizer == self.viewportPanGesture
    || gestureRecognizer == self.viewportPinchGesture
    || gestureRecognizer == self.selectionGesture
    || gestureRecognizer == self.selectionTapGesture
    || gestureRecognizer == self.textTapGesture
    || gestureRecognizer == self.fingerInkPanGesture
    || gestureRecognizer == self.pencilInkPanGesture) {
    [self interruptViewportMotionForUserTouch];
  }
  if (gestureRecognizer == self.viewportPanGesture) {
    if (@available(iOS 9.1, *)) {
      if (touch.type == UITouchTypePencil) return NO;
    }
    BOOL drawingTool = [@[@"pen", @"highlight", @"line", @"arrow", @"rect", @"ellipse", @"erase"] containsObject:self.inkTool ?: @"view"];
    if (drawingTool && self.fingerDrawingEnabled) return NO;
    return YES;
  }
  if (gestureRecognizer == self.viewportPinchGesture) {
    return YES;
  }
  if (gestureRecognizer == self.selectionGesture) {
    if (![self.inkTool isEqualToString:@"select"] || !self.selectionGestureEnabled) return NO;
    if ([self selectionMenuActionAtViewPoint:[touch locationInView:self]] != nil) return NO;
    if (self.fingerDrawingEnabled) return YES;
    if (@available(iOS 9.1, *)) return touch.type == UITouchTypePencil;
    return YES;
  }
  if (gestureRecognizer == self.selectionTapGesture) {
    if (![self.inkTool isEqualToString:@"select"] || !self.selectionGestureEnabled || !self.selectionMenuEnabled) return NO;
    return [self selectionMenuActionAtViewPoint:[touch locationInView:self]] != nil;
  }
  if (gestureRecognizer == self.textTapGesture) {
    if (![self.inkTool isEqualToString:@"text"] || !self.textGestureEnabled) return NO;
    UIView *view = touch.view;
    while (view != nil && view != self) {
      if ([view isKindOfClass:BsnPdfTextAnnotationView.class]) return NO;
      view = view.superview;
    }
    if (self.activeTextAnnotationId.length > 0) return YES;
    NSDictionary *hit = [self hitPagePointAtViewPoint:[touch locationInView:self]];
    return hit[@"point"] != nil;
  }
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
  CGPoint contentPoint = [self contentPointForViewportPoint:viewPoint];
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
  if (self.retainedLiveStroke != nil) {
    CGRect dirtyRect = self.retainedLiveStrokeDirtyRect;
    if (CGRectIsNull(dirtyRect)) dirtyRect = [self dirtyRectForStroke:self.retainedLiveStroke];
    self.retainedLiveStroke = nil;
    self.retainedLiveStrokeDirtyRect = CGRectNull;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(clearRetainedLiveStroke) object:nil];
    if (!CGRectIsNull(dirtyRect) && !CGRectIsEmpty(dirtyRect)) {
      [self setLiveInkNeedsDisplayInContentRect:dirtyRect];
    }
  }
  BsnPdfPageLayout *layout = hit[@"layout"];
  NSDictionary *point = hit[@"point"];
  if ([self.inkTool isEqualToString:@"erase"]) {
    self.inkInteractionActive = YES;
    self.suppressInkViewportEventsUntil = CACurrentMediaTime() + 0.25;
    if ([self.eraserMode isEqualToString:@"stroke"]) {
      NSString *strokeId = [self hitStrokeIdAtPoint:point inLayout:layout];
      if (strokeId != nil) {
        [self removeInkStrokeLocallyWithId:strokeId];
        if (self.onRemoveInkStroke != nil) self.onRemoveInkStroke(@{@"strokeId": strokeId});
      }
    } else {
      [self beginPartialEraseIfNeeded];
      if ([self shouldProcessEraserPoint:point force:YES]) {
        [self erasePartialAtPoint:point inLayout:layout];
      }
    }
    return;
  }

  NSString *style = [self.inkTool isEqualToString:@"highlight"] ? @"highlight" : ([self isShapeTool:self.inkTool] ? @"shape" : @"pen");
  self.inkInteractionActive = YES;
  self.suppressInkViewportEventsUntil = CACurrentMediaTime() + 0.25;
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
  self.activePredictedStroke = nil;
  self.lastActiveStrokeDirtyRect = CGRectNull;
  [self redrawContent];
}

- (void)moveInkAtPoint:(CGPoint)viewPoint
{
  [self moveInkAtPoint:viewPoint predicted:NO];
}

- (void)moveInkAtPoint:(CGPoint)viewPoint predicted:(BOOL)predicted
{
  NSDictionary *hit = [self hitPagePointAtViewPoint:viewPoint];
  if (hit == nil) return;
  BsnPdfPageLayout *layout = hit[@"layout"];
  NSDictionary *point = hit[@"point"];
  if (predicted && ([self.inkTool isEqualToString:@"erase"] || self.activeStroke == nil)) return;
  if (!predicted) self.suppressInkViewportEventsUntil = CACurrentMediaTime() + 0.25;
  if ([self.inkTool isEqualToString:@"erase"]) {
    self.activePredictedStroke = nil;
    if ([self.eraserMode isEqualToString:@"stroke"]) {
      NSString *strokeId = [self hitStrokeIdAtPoint:point inLayout:layout];
      if (strokeId != nil) {
        [self removeInkStrokeLocallyWithId:strokeId];
        if (self.onRemoveInkStroke != nil) self.onRemoveInkStroke(@{@"strokeId": strokeId});
      }
    } else {
      [self beginPartialEraseIfNeeded];
      if ([self shouldProcessEraserPoint:point force:NO]) {
        [self erasePartialAtPoint:point inLayout:layout];
      }
    }
    return;
  }
  if (self.activeStroke != nil && ![self stroke:self.activeStroke belongsToLayout:layout]) {
    self.activePredictedStroke = nil;
    return;
  }
  NSDictionary *baseStroke = (predicted && self.activePredictedStroke != nil) ? self.activePredictedStroke : self.activeStroke;
  NSMutableDictionary *targetStroke = predicted ? [baseStroke mutableCopy] : self.activeStroke;
  NSMutableArray *points = predicted
    ? [NSMutableArray arrayWithArray:baseStroke[@"points"] ?: @[]]
    : self.activeStroke[@"points"];
  if (![points isKindOfClass:NSMutableArray.class]) return;
  if ([targetStroke[@"style"] isEqualToString:@"shape"]) {
    if (points.count <= 1) [points addObject:point]; else points[1] = point;
  } else {
    NSDictionary *last = points.lastObject;
    CGFloat dx = [last[@"x"] doubleValue] - [point[@"x"] doubleValue];
    CGFloat dy = [last[@"y"] doubleValue] - [point[@"y"] doubleValue];
    if (last == nil || hypot(dx, dy) > 0.8) [points addObject:point];
  }
  if (predicted) {
    targetStroke[@"points"] = points;
    self.activePredictedStroke = [targetStroke copy];
  } else {
    self.activePredictedStroke = nil;
  }
  [self redrawContent];
}

- (void)endInkWithCommit:(BOOL)commit
{
  if ([self.inkTool isEqualToString:@"erase"] && ![self.eraserMode isEqualToString:@"stroke"]) {
    self.inkInteractionActive = NO;
    self.suppressInkViewportEventsUntil = CACurrentMediaTime() + 0.18;
    [self endPartialEraseWithCommit:commit];
    [self flushDeferredContentInvalidation];
    [self flushDeferredEditOverlayInvalidation];
    return;
  }
  NSDictionary *stroke = self.activeStroke;
  CGRect dirtyRect = self.lastActiveStrokeDirtyRect;
  NSArray *points = stroke[@"points"];
  BOOL shouldCommit = commit && stroke != nil && points.count > 1;
  CGRect finalDirtyRect = dirtyRect;
  if (shouldCommit) finalDirtyRect = BsnPdfUnionDirtyRects(finalDirtyRect, [self dirtyRectForStroke:stroke]);
  self.activeStroke = nil;
  self.activePredictedStroke = nil;
  self.inkInteractionActive = NO;
  self.suppressInkViewportEventsUntil = CACurrentMediaTime() + 0.18;
  [self flushDeferredContentInvalidation];
  [self flushDeferredEditOverlayInvalidation];
  self.lastActiveStrokeDirtyRect = CGRectNull;
  if (shouldCommit) {
    NSDictionary *strokeCopy = [stroke copy];
    [self.pendingCommittedStrokes addObject:strokeCopy];
    self.retainedLiveStroke = strokeCopy;
    self.retainedLiveStrokeDirtyRect = finalDirtyRect;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(clearRetainedLiveStroke) object:nil];
    [self performSelector:@selector(clearRetainedLiveStroke) withObject:nil afterDelay:0.16];
    [self scheduleDeferredInkCommit:strokeCopy];
    if (!CGRectIsNull(finalDirtyRect) && !CGRectIsEmpty(finalDirtyRect)) {
      [self setLiveInkNeedsDisplayInContentRect:finalDirtyRect];
      [self setEditOverlayNeedsDisplayInRectSafely:finalDirtyRect];
    } else {
      [self.liveInkView setNeedsDisplay];
      [self redrawContent];
    }
    return;
  }
  if (!CGRectIsNull(dirtyRect)) {
    [self setLiveInkNeedsDisplayInContentRect:dirtyRect];
    [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
  } else {
    [self.liveInkView setNeedsDisplay];
    [self redrawContent];
  }
}

- (void)clearRetainedLiveStroke
{
  if (self.retainedLiveStroke == nil) return;
  CGRect dirtyRect = self.retainedLiveStrokeDirtyRect;
  if (CGRectIsNull(dirtyRect)) dirtyRect = [self dirtyRectForStroke:self.retainedLiveStroke];
  self.retainedLiveStroke = nil;
  self.retainedLiveStrokeDirtyRect = CGRectNull;
  if (!CGRectIsNull(dirtyRect) && !CGRectIsEmpty(dirtyRect)) {
    [self setLiveInkNeedsDisplayInContentRect:dirtyRect];
    [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
  } else {
    [self.liveInkView setNeedsDisplay];
    [self setEditOverlayNeedsDisplaySafely];
  }
}

- (void)scheduleDeferredInkCommit:(NSDictionary *)stroke
{
  if (stroke == nil) return;
  [self.deferredCommitStrokes addObject:[stroke copy]];
  if (self.deferredCommitScheduled) return;
  self.deferredCommitScheduled = YES;
  [self performSelector:@selector(flushDeferredInkCommits) withObject:nil afterDelay:0.045];
}

- (void)flushDeferredInkCommits
{
  self.deferredCommitScheduled = NO;
  if (self.deferredCommitStrokes.count == 0 || self.onCommitInkStroke == nil) {
    [self.deferredCommitStrokes removeAllObjects];
    return;
  }
  NSArray<NSDictionary *> *strokes = [self.deferredCommitStrokes copy];
  [self.deferredCommitStrokes removeAllObjects];
  for (NSDictionary *stroke in strokes) {
    self.onCommitInkStroke(stroke);
  }
}

- (CGFloat)viewportScale
{
  return self.customViewportCoreEnabled ? MAX(0.0001, self.coreScale) : MAX(0.0001, self.scrollView.zoomScale);
}

- (CGPoint)viewportContentOffset
{
  if (!self.customViewportCoreEnabled) return self.scrollView.contentOffset;
  CGFloat zoom = MAX(0.0001, self.coreScale);
  return CGPointMake(-self.coreTranslateX, self.coreScrollYDocument * zoom);
}

- (CGSize)viewportContentSize
{
  if (!self.customViewportCoreEnabled) return self.scrollView.contentSize;
  CGFloat zoom = MAX(0.0001, self.coreScale);
  return CGSizeMake(MAX(1.0, self.coreContentWidth * zoom), MAX(1.0, self.coreContentHeight * zoom));
}

- (CGPoint)contentPointForViewportPoint:(CGPoint)viewPoint
{
  CGFloat zoom = [self viewportScale];
  CGPoint offset = [self viewportContentOffset];
  return CGPointMake((viewPoint.x + offset.x) / zoom, (viewPoint.y + offset.y) / zoom);
}

- (NSMutableDictionary *)customViewportAnchorForLayout:(BsnPdfPageLayout *)layout contentPoint:(CGPoint)contentPoint clamped:(BOOL)clamped
{
  CGFloat progressX = (contentPoint.x - CGRectGetMinX(layout.frame)) / MAX(1.0, layout.frame.size.width);
  CGFloat progressY = (contentPoint.y - CGRectGetMinY(layout.frame)) / MAX(1.0, layout.frame.size.height);
  if (clamped) {
    progressX = MIN(1.0, MAX(0, progressX));
    progressY = MIN(1.0, MAX(0, progressY));
  }
  NSMutableDictionary *anchor = [@{
    @"type": @"page",
    @"pageId": layout.pageId ?: @"",
    @"progressX": @(progressX),
    @"progressY": @(progressY),
    @"contentX": @(contentPoint.x),
    @"contentY": @(contentPoint.y),
  } mutableCopy];
  if (layout.pageNumber != nil) anchor[@"pageNumber"] = layout.pageNumber;
  if (layout.generatedPageId != nil) anchor[@"generatedPageId"] = layout.generatedPageId;
  return anchor;
}

- (nullable NSDictionary *)captureCustomViewportAnchorAtViewPoint:(CGPoint)viewPoint
{
  if (self.layouts.count == 0) return nil;
  CGPoint contentPoint = [self contentPointForViewportPoint:viewPoint];
  BsnPdfPageLayout *containing = nil;
  BsnPdfPageLayout *before = nil;
  BsnPdfPageLayout *after = nil;
  BsnPdfPageLayout *nearest = nil;
  CGFloat nearestDistance = CGFLOAT_MAX;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (CGRectContainsPoint(layout.frame, contentPoint)) containing = layout;
    if (CGRectGetMaxY(layout.frame) <= contentPoint.y) before = layout;
    if (after == nil && CGRectGetMinY(layout.frame) >= contentPoint.y) after = layout;
    CGFloat distance = CGRectContainsPoint(layout.frame, contentPoint)
      ? 0
      : hypot(CGRectGetMidX(layout.frame) - contentPoint.x, CGRectGetMidY(layout.frame) - contentPoint.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = layout;
    }
  }
  if (containing != nil) return [self customViewportAnchorForLayout:containing contentPoint:contentPoint clamped:NO];
  if (before != nil && after != nil) {
    CGFloat gapTop = CGRectGetMaxY(before.frame);
    CGFloat gapBottom = CGRectGetMinY(after.frame);
    CGFloat gapProgressY = (contentPoint.y - gapTop) / MAX(1.0, gapBottom - gapTop);
    CGFloat progressX = contentPoint.x / MAX(1.0, self.coreContentWidth);
    NSMutableDictionary *anchor = [@{
      @"type": @"gap",
      @"gapBeforePageId": before.pageId ?: @"",
      @"gapAfterPageId": after.pageId ?: @"",
      @"gapProgressY": @(MIN(1.0, MAX(0, gapProgressY))),
      @"progressX": @(MIN(1.0, MAX(0, progressX))),
      @"contentX": @(contentPoint.x),
      @"contentY": @(contentPoint.y),
    } mutableCopy];
    if (before.pageNumber != nil) anchor[@"gapBeforePageNumber"] = before.pageNumber;
    if (after.pageNumber != nil) anchor[@"gapAfterPageNumber"] = after.pageNumber;
    return anchor;
  }
  if (nearest != nil) return [self customViewportAnchorForLayout:nearest contentPoint:contentPoint clamped:YES];
  return @{
    @"type": @"absolute",
    @"contentX": @(contentPoint.x),
    @"contentY": @(contentPoint.y),
  };
}

- (BOOL)layout:(BsnPdfPageLayout *)layout matchesPageId:(NSString *)pageId generatedPageId:(NSString *)generatedPageId pageNumber:(NSNumber *)pageNumber
{
  if (layout == nil) return NO;
  if (pageId.length > 0 && [layout.pageId isEqualToString:pageId]) return YES;
  if (generatedPageId.length > 0 && [layout.generatedPageId isEqualToString:generatedPageId]) return YES;
  if (pageNumber != nil && layout.pageNumber != nil && layout.pageNumber.integerValue == pageNumber.integerValue) return YES;
  return NO;
}

- (CGPoint)contentPointForCustomViewportAnchor:(NSDictionary *)anchor fallbackContentPoint:(CGPoint)fallbackContentPoint
{
  if (anchor == nil || self.layouts.count == 0) return fallbackContentPoint;
  NSString *type = [RCTConvert NSString:anchor[@"type"]] ?: @"absolute";
  if ([type isEqualToString:@"page"]) {
    NSString *pageId = [RCTConvert NSString:anchor[@"pageId"]];
    NSString *generatedPageId = [RCTConvert NSString:anchor[@"generatedPageId"]];
    NSNumber *pageNumber = anchor[@"pageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"pageNumber"]] : nil;
    for (BsnPdfPageLayout *layout in self.layouts) {
      if (![self layout:layout matchesPageId:pageId generatedPageId:generatedPageId pageNumber:pageNumber]) continue;
      CGFloat progressX = [anchor[@"progressX"] doubleValue];
      CGFloat progressY = [anchor[@"progressY"] doubleValue];
      return CGPointMake(
        CGRectGetMinX(layout.frame) + layout.frame.size.width * progressX,
        CGRectGetMinY(layout.frame) + layout.frame.size.height * progressY
      );
    }
  } else if ([type isEqualToString:@"gap"]) {
    NSString *beforePageId = [RCTConvert NSString:anchor[@"gapBeforePageId"]];
    NSString *afterPageId = [RCTConvert NSString:anchor[@"gapAfterPageId"]];
    NSNumber *beforePageNumber = anchor[@"gapBeforePageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"gapBeforePageNumber"]] : nil;
    NSNumber *afterPageNumber = anchor[@"gapAfterPageNumber"] != nil ? [RCTConvert NSNumber:anchor[@"gapAfterPageNumber"]] : nil;
    BsnPdfPageLayout *before = nil;
    BsnPdfPageLayout *after = nil;
    for (BsnPdfPageLayout *layout in self.layouts) {
      if (before == nil && [self layout:layout matchesPageId:beforePageId generatedPageId:nil pageNumber:beforePageNumber]) before = layout;
      if (after == nil && [self layout:layout matchesPageId:afterPageId generatedPageId:nil pageNumber:afterPageNumber]) after = layout;
    }
    if (before != nil && after != nil) {
      CGFloat gapTop = CGRectGetMaxY(before.frame);
      CGFloat gapBottom = CGRectGetMinY(after.frame);
      CGFloat progressY = MIN(1.0, MAX(0, [anchor[@"gapProgressY"] doubleValue]));
      CGFloat progressX = MIN(1.0, MAX(0, [anchor[@"progressX"] doubleValue]));
      return CGPointMake(
        self.coreContentWidth * progressX,
        gapTop + MAX(1.0, gapBottom - gapTop) * progressY
      );
    }
  }
  NSNumber *contentX = anchor[@"contentX"] != nil ? [RCTConvert NSNumber:anchor[@"contentX"]] : nil;
  NSNumber *contentY = anchor[@"contentY"] != nil ? [RCTConvert NSNumber:anchor[@"contentY"]] : nil;
  if (contentX != nil && contentY != nil) return CGPointMake(contentX.doubleValue, contentY.doubleValue);
  return fallbackContentPoint;
}

- (CGRect)rawViewportRectForContentRect:(CGRect)contentRect
{
  if (CGRectIsNull(contentRect)) return CGRectNull;
  CGFloat zoom = [self viewportScale];
  CGPoint offset = [self viewportContentOffset];
  return CGRectMake(
    contentRect.origin.x * zoom - offset.x,
    contentRect.origin.y * zoom - offset.y,
    contentRect.size.width * zoom,
    contentRect.size.height * zoom
  );
}

- (void)syncCustomCoreFromScrollView
{
  CGFloat zoom = MAX(BsnPdfMinZoom, MIN(BsnPdfMaxZoom, self.scrollView.zoomScale));
  self.coreScale = zoom;
  self.coreScrollYDocument = self.scrollView.contentOffset.y / MAX(0.0001, zoom);
  self.coreTranslateX = -self.scrollView.contentOffset.x;
  self.coreContentWidth = MAX(1.0, self.contentView.bounds.size.width);
  self.coreContentHeight = MAX(1.0, self.contentView.bounds.size.height);
  [self clampCustomViewportSnap:NO];
}

- (void)syncScrollViewFromCustomCore
{
  CGFloat zoom = MAX(BsnPdfMinZoom, MIN(BsnPdfMaxZoom, self.coreScale));
  CGPoint offset = CGPointMake(-self.coreTranslateX, self.coreScrollYDocument * zoom);
  self.syncingCustomViewportToScrollView = YES;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [UIView performWithoutAnimation:^{
    self.scrollView.minimumZoomScale = BsnPdfMinZoom;
    self.scrollView.maximumZoomScale = BsnPdfMaxZoom;
    self.scrollView.zoomScale = zoom;
    self.scrollView.contentOffset = offset;
    [self.scrollView layoutIfNeeded];
  }];
  [CATransaction commit];
  self.syncingCustomViewportToScrollView = NO;
  self.lastContentOffsetY = self.scrollView.contentOffset.y;
}

- (void)updateViewportModeViews
{
  self.scrollView.hidden = self.customViewportCoreEnabled;
  self.customCoreView.hidden = !self.customViewportCoreEnabled;
  self.customNativeSubviewLayer.hidden = !self.customViewportCoreEnabled;
  if (self.customViewportCoreEnabled) {
    [self syncCustomCoreFromScrollView];
    [self syncScrollViewFromCustomCore];
    [self.customCoreView setNeedsDisplay];
  } else {
    [self syncScrollViewFromCustomCore];
    [self setContentNeedsDisplaySafely];
    [self setEditOverlayNeedsDisplaySafely];
  }
  [self updateTextAnnotationViews];
  [self updatePageReferenceViews];
  [self requestViewportChangedForce:YES];
}

- (void)preserveCustomViewportContentPoint:(CGPoint)contentPoint atViewPoint:(CGPoint)viewPoint reason:(NSString *)reason
{
  if (!self.customViewportCoreEnabled) return;
  if (!isfinite(contentPoint.x) || !isfinite(contentPoint.y)) return;
  if (!isfinite(viewPoint.x) || !isfinite(viewPoint.y)) return;
  CGFloat beforeScrollY = self.coreScrollYDocument;
  CGFloat beforeTranslateX = self.coreTranslateX;
  [self clampCustomViewportSnap:NO preservingContentPoint:contentPoint atViewPoint:viewPoint];
  [self syncScrollViewFromCustomCore];
  BsnPdfRenderDebugLog(self,
    @"[BsnPdfViewport][custom-core] preserve reason=%@ focusDoc=(%.1f,%.1f) view=(%.1f,%.1f) scale=%.3f scrollY %.1f->%.1f translateX %.1f->%.1f",
    reason ?: @"unknown",
    contentPoint.x,
    contentPoint.y,
    viewPoint.x,
    viewPoint.y,
    self.coreScale,
    beforeScrollY,
    self.coreScrollYDocument,
    beforeTranslateX,
    self.coreTranslateX);
  [self invalidateCustomViewportSurfaces];
}

- (void)invalidateCustomViewportSurfaces
{
  if (!self.customViewportCoreEnabled) return;
  [self.customCoreView setNeedsDisplay];
  [self.liveInkView setNeedsDisplay];
  [self updateTextAnnotationViews];
  [self updatePageReferenceViews];
}

- (void)clampCustomViewportSnap:(BOOL)snap
{
  [self clampCustomViewportSnap:snap preservingContentPoint:CGPointMake(NAN, NAN) atViewPoint:CGPointZero];
}

- (void)clampCustomViewportSnap:(BOOL)snap preservingContentPoint:(CGPoint)contentPoint atViewPoint:(CGPoint)viewPoint
{
  CGFloat zoom = MIN(BsnPdfMaxZoom, MAX(BsnPdfMinZoom, self.coreScale));
  if (snap && zoom <= 1.02) {
    zoom = BsnPdfMinZoom;
    [self resetHiResOverlayState];
  }
  self.coreScale = zoom;
  BOOL hasFocus = isfinite(contentPoint.x) && isfinite(contentPoint.y);
  if (hasFocus) {
    self.coreScrollYDocument = contentPoint.y - viewPoint.y / zoom;
    self.coreTranslateX = viewPoint.x - contentPoint.x * zoom;
  }

  CGFloat contentWidth = MAX(1.0, self.coreContentWidth);
  CGFloat contentHeight = MAX(1.0, self.coreContentHeight);
  CGFloat maxScrollY = MAX(0, contentHeight - self.bounds.size.height / zoom);
  self.coreScrollYDocument = MIN(MAX(0, self.coreScrollYDocument), maxScrollY);

  if (zoom <= BsnPdfMinZoom + 0.0001) {
    self.coreTranslateX = 0;
  } else {
    CGFloat minTranslateX = MIN(0, self.bounds.size.width - contentWidth * zoom);
    self.coreTranslateX = MIN(0, MAX(minTranslateX, self.coreTranslateX));
  }
}

- (void)applyCustomViewportDidChangeWithDeltaY:(CGFloat)deltaY force:(BOOL)force
{
  if (!self.customViewportCoreEnabled) return;
  [self clampCustomViewportSnap:NO];
  [self syncScrollViewFromCustomCore];
  [self updateBaseRenderDirection:deltaY];
  [self invalidateCustomViewportSurfaces];
  [self scheduleBaseRendersForce:NO];
  [self emitPageChangedIfNeededFromSource:self.viewportPinchActive ? @"customViewportPinch" : (self.viewportPanActive ? @"customViewportPan" : @"customViewport")];
  [self saveViewportAnchor];
  [self requestViewportChangedForce:force];
}

- (CGRect)viewportRectForContentRect:(CGRect)contentRect
{
  if (CGRectIsNull(contentRect)) return CGRectNull;
  CGRect viewportRect = [self rawViewportRectForContentRect:contentRect];
  return CGRectIntersection(CGRectInset(self.liveInkView.bounds, -64.0, -64.0), CGRectInset(viewportRect, -8.0, -8.0));
}

- (CGRect)contentRectForViewportRect:(CGRect)viewportRect
{
  CGFloat zoom = [self viewportScale];
  CGPoint offset = [self viewportContentOffset];
  return CGRectMake(
    (viewportRect.origin.x + offset.x) / zoom,
    (viewportRect.origin.y + offset.y) / zoom,
    viewportRect.size.width / zoom,
    viewportRect.size.height / zoom
  );
}

- (CGRect)contentRectForPageNumber:(NSInteger)pageNumber
{
  if (pageNumber < 1) return CGRectNull;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (layout.pageNumber != nil && layout.pageNumber.integerValue == pageNumber) {
      return layout.frame;
    }
  }
  return CGRectNull;
}

- (CGRect)contentRectForHiResRequest:(BsnPdfHiResRequest *)request
{
  if (request == nil) return CGRectNull;
  CGRect pageRect = [self contentRectForPageNumber:request.pageNumber];
  if (CGRectIsNull(pageRect) || CGRectIsEmpty(pageRect)) return CGRectNull;
  CGRect overlayRect = CGRectMake(
    pageRect.origin.x + pageRect.size.width * request.regionX,
    pageRect.origin.y + pageRect.size.height * request.regionY,
    pageRect.size.width * request.regionWidth,
    pageRect.size.height * request.regionHeight
  );
  return CGRectInset(overlayRect, -2.0, -2.0);
}

- (CGRect)contentRectForHiResOverlay:(BsnPdfHiResOverlay *)overlay
{
  return [self contentRectForHiResRequest:overlay.request];
}

- (void)setLiveInkNeedsDisplayInContentRect:(CGRect)contentRect
{
  if (CGRectIsNull(contentRect)) {
    [self logRenderDebugEvent:@"invalidate" target:@"liveInk" action:@"set-full" rect:CGRectNull extra:@""];
    [self.liveInkView setNeedsDisplay];
    return;
  }
  CGRect viewportRect = [self viewportRectForContentRect:contentRect];
  if (CGRectIsNull(viewportRect) || CGRectIsEmpty(viewportRect)) return;
  [self logRenderDebugEvent:@"invalidate" target:@"liveInk" action:@"set-rect" rect:viewportRect extra:@""];
  [self.liveInkView setNeedsDisplayInRect:viewportRect];
}

- (void)setContentNeedsDisplayForPageNumber:(NSInteger)pageNumber
{
  CGRect rect = [self contentRectForPageNumber:pageNumber];
  if (CGRectIsNull(rect) || CGRectIsEmpty(rect)) return;
  [self setContentNeedsDisplayInRectSafely:rect];
}

- (void)setContentNeedsDisplayForHiResRequest:(BsnPdfHiResRequest *)request
{
  CGRect rect = [self contentRectForHiResRequest:request];
  if (CGRectIsNull(rect) || CGRectIsEmpty(rect)) return;
  [self setContentNeedsDisplayInRectSafely:rect];
}

- (void)setContentNeedsDisplayForHiResOverlay:(BsnPdfHiResOverlay *)overlay
{
  CGRect rect = [self contentRectForHiResOverlay:overlay];
  if (CGRectIsNull(rect) || CGRectIsEmpty(rect)) return;
  [self setContentNeedsDisplayInRectSafely:rect];
}

- (void)setContentNeedsDisplayForRectChangeFrom:(CGRect)oldRect to:(CGRect)newRect
{
  CGRect dirtyRect = BsnPdfUnionDirtyRects(oldRect, newRect);
  if (CGRectIsNull(dirtyRect) || CGRectIsEmpty(dirtyRect)) return;
  [self setContentNeedsDisplayInRectSafely:dirtyRect];
}

- (void)setEditOverlayNeedsDisplayForRectChangeFrom:(CGRect)oldRect to:(CGRect)newRect
{
  CGRect dirtyRect = BsnPdfUnionDirtyRects(oldRect, newRect);
  if (CGRectIsNull(dirtyRect) || CGRectIsEmpty(dirtyRect)) return;
  [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
}

- (void)setContentNeedsDisplaySafely
{
  if (self.inkInteractionActive || [self isViewportMotionActive]) {
    self.deferredContentInvalidation = YES;
    self.deferredContentInvalidationRect = CGRectNull;
    [self logRenderDebugEvent:@"invalidate" target:@"content" action:@"defer-full" rect:CGRectNull extra:@""];
    return;
  }
  [self logRenderDebugEvent:@"invalidate" target:@"content" action:@"set-full" rect:self.contentView.bounds extra:@""];
  if (self.customViewportCoreEnabled) {
    [self.customCoreView setNeedsDisplay];
    return;
  }
  [self.contentView setNeedsDisplay];
}

- (void)setContentNeedsDisplayInRectSafely:(CGRect)rect
{
  if (CGRectIsNull(rect)) {
    [self setContentNeedsDisplaySafely];
    return;
  }
  if (self.inkInteractionActive || [self isViewportMotionActive]) {
    if (!self.deferredContentInvalidation) {
      self.deferredContentInvalidationRect = rect;
    } else if (!CGRectIsNull(self.deferredContentInvalidationRect)) {
      self.deferredContentInvalidationRect = CGRectUnion(self.deferredContentInvalidationRect, rect);
    }
    self.deferredContentInvalidation = YES;
    [self logRenderDebugEvent:@"invalidate" target:@"content" action:@"defer-rect" rect:rect extra:@""];
    return;
  }
  [self logRenderDebugEvent:@"invalidate" target:@"content" action:@"set-rect" rect:rect extra:@""];
  if (self.customViewportCoreEnabled) {
    CGRect viewportRect = [self rawViewportRectForContentRect:rect];
    if (!CGRectIsNull(viewportRect) && !CGRectIsEmpty(viewportRect)) {
      [self.customCoreView setNeedsDisplayInRect:CGRectInset(viewportRect, -4.0, -4.0)];
    }
    return;
  }
  [self.contentView setNeedsDisplayInRect:rect];
}

- (void)flushDeferredContentInvalidation
{
  if (!self.deferredContentInvalidation) return;
  CGRect rect = self.deferredContentInvalidationRect;
  self.deferredContentInvalidation = NO;
  self.deferredContentInvalidationRect = CGRectNull;
  if (CGRectIsNull(rect)) {
    [self logRenderDebugEvent:@"invalidate" target:@"content" action:@"flush-full" rect:CGRectNull extra:@""];
    if (self.customViewportCoreEnabled) {
      [self.customCoreView setNeedsDisplay];
      return;
    }
    [self.contentView setNeedsDisplay];
  } else {
    [self logRenderDebugEvent:@"invalidate" target:@"content" action:@"flush-rect" rect:rect extra:@""];
    if (self.customViewportCoreEnabled) {
      CGRect viewportRect = [self rawViewportRectForContentRect:rect];
      if (!CGRectIsNull(viewportRect) && !CGRectIsEmpty(viewportRect)) {
        [self.customCoreView setNeedsDisplayInRect:CGRectInset(viewportRect, -4.0, -4.0)];
      }
      return;
    }
    [self.contentView setNeedsDisplayInRect:rect];
  }
}

- (void)setEditOverlayNeedsDisplaySafely
{
  if ([self isViewportMotionActive]) {
    self.deferredEditOverlayInvalidation = YES;
    self.deferredEditOverlayInvalidationRect = CGRectNull;
    [self logRenderDebugEvent:@"invalidate" target:@"editOverlay" action:@"defer-full" rect:CGRectNull extra:@""];
    return;
  }
  [self logRenderDebugEvent:@"invalidate" target:@"editOverlay" action:@"set-full" rect:self.editOverlayView.bounds extra:@""];
  if (self.customViewportCoreEnabled) {
    [self.customCoreView setNeedsDisplay];
    return;
  }
  [self.editOverlayView setNeedsDisplay];
}

- (void)setEditOverlayNeedsDisplayInRectSafely:(CGRect)rect
{
  if (CGRectIsNull(rect)) {
    [self setEditOverlayNeedsDisplaySafely];
    return;
  }
  if (CGRectIsEmpty(rect)) return;
  if ([self isViewportMotionActive]) {
    if (!self.deferredEditOverlayInvalidation) {
      self.deferredEditOverlayInvalidationRect = rect;
    } else if (!CGRectIsNull(self.deferredEditOverlayInvalidationRect)) {
      self.deferredEditOverlayInvalidationRect = CGRectUnion(self.deferredEditOverlayInvalidationRect, rect);
    }
    self.deferredEditOverlayInvalidation = YES;
    [self logRenderDebugEvent:@"invalidate" target:@"editOverlay" action:@"defer-rect" rect:rect extra:@""];
    return;
  }
  [self logRenderDebugEvent:@"invalidate" target:@"editOverlay" action:@"set-rect" rect:rect extra:@""];
  if (self.customViewportCoreEnabled) {
    CGRect viewportRect = [self rawViewportRectForContentRect:rect];
    if (!CGRectIsNull(viewportRect) && !CGRectIsEmpty(viewportRect)) {
      [self.customCoreView setNeedsDisplayInRect:CGRectInset(viewportRect, -8.0, -8.0)];
    }
    return;
  }
  [self.editOverlayView setNeedsDisplayInRect:rect];
}

- (void)flushDeferredEditOverlayInvalidation
{
  if (!self.deferredEditOverlayInvalidation) return;
  CGRect rect = self.deferredEditOverlayInvalidationRect;
  self.deferredEditOverlayInvalidation = NO;
  self.deferredEditOverlayInvalidationRect = CGRectNull;
  if (CGRectIsNull(rect)) {
    [self logRenderDebugEvent:@"invalidate" target:@"editOverlay" action:@"flush-full" rect:CGRectNull extra:@""];
    if (self.customViewportCoreEnabled) {
      [self.customCoreView setNeedsDisplay];
      return;
    }
    [self.editOverlayView setNeedsDisplay];
  } else {
    [self logRenderDebugEvent:@"invalidate" target:@"editOverlay" action:@"flush-rect" rect:rect extra:@""];
    if (self.customViewportCoreEnabled) {
      CGRect viewportRect = [self rawViewportRectForContentRect:rect];
      if (!CGRectIsNull(viewportRect) && !CGRectIsEmpty(viewportRect)) {
        [self.customCoreView setNeedsDisplayInRect:CGRectInset(viewportRect, -8.0, -8.0)];
      }
      return;
    }
    [self.editOverlayView setNeedsDisplayInRect:rect];
  }
}

- (BOOL)isShapeTool:(NSString *)tool
{
  return [@[@"line", @"arrow", @"rect", @"ellipse"] containsObject:tool ?: @""];
}

- (BOOL)imageAnnotation:(NSDictionary *)annotation belongsToLayout:(BsnPdfPageLayout *)layout
{
  NSString *generatedId = [RCTConvert NSString:annotation[@"generatedPageId"]];
  if (generatedId.length > 0) {
    return layout.generatedPageId != nil && [layout.generatedPageId isEqualToString:generatedId];
  }
  NSNumber *pageNumber = annotation[@"pageNumber"] != nil ? [RCTConvert NSNumber:annotation[@"pageNumber"]] : nil;
  return layout.pageNumber != nil && pageNumber != nil && layout.pageNumber.integerValue == pageNumber.integerValue;
}

- (CGRect)rectForImageAnnotation:(NSDictionary *)annotation layout:(BsnPdfPageLayout *)layout
{
  CGFloat pageWidth = MAX(1.0, annotation[@"pageWidth"] != nil ? [annotation[@"pageWidth"] doubleValue] : layout.logicalSize.width);
  CGFloat pageHeight = MAX(1.0, annotation[@"pageHeight"] != nil ? [annotation[@"pageHeight"] doubleValue] : layout.logicalSize.height);
  CGFloat x = layout.frame.origin.x + [annotation[@"x"] doubleValue] / pageWidth * layout.frame.size.width;
  CGFloat y = layout.frame.origin.y + [annotation[@"y"] doubleValue] / pageHeight * layout.frame.size.height;
  CGFloat width = MAX(4.0, [annotation[@"width"] doubleValue] / pageWidth * layout.frame.size.width);
  CGFloat height = MAX(4.0, [annotation[@"height"] doubleValue] / pageHeight * layout.frame.size.height);
  return CGRectMake(x, y, width, height);
}

- (CGRect)dirtyRectForImageAnnotation:(NSDictionary *)annotation
{
  if (![annotation isKindOfClass:NSDictionary.class]) return CGRectNull;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (![self imageAnnotation:annotation belongsToLayout:layout]) continue;
    CGRect rect = [self rectForImageAnnotation:annotation layout:layout];
    return CGRectInset(rect, -4.0, -4.0);
  }
  return CGRectNull;
}

- (CGRect)dirtyRectForImageAnnotationChangesFrom:(NSArray<NSDictionary *> *)beforeAnnotations to:(NSArray<NSDictionary *> *)afterAnnotations
{
  if ([beforeAnnotations isEqualToArray:afterAnnotations]) return CGRectNull;
  CGRect dirtyRect = CGRectNull;
  for (NSDictionary *annotation in beforeAnnotations ?: @[]) {
    dirtyRect = BsnPdfUnionDirtyRects(dirtyRect, [self dirtyRectForImageAnnotation:annotation]);
  }
  for (NSDictionary *annotation in afterAnnotations ?: @[]) {
    dirtyRect = BsnPdfUnionDirtyRects(dirtyRect, [self dirtyRectForImageAnnotation:annotation]);
  }
  return dirtyRect;
}

- (NSString *)imageCacheKeyForAnnotation:(NSDictionary *)annotation
{
  NSString *uri = [RCTConvert NSString:annotation[@"uri"]] ?: @"";
  return uri.length > 0 ? uri : ([RCTConvert NSString:annotation[@"id"]] ?: @"");
}

- (nullable UIImage *)decodeImageFromUri:(NSString *)uri
{
  if (uri.length == 0) return nil;
  if ([uri hasPrefix:@"file://"]) {
    NSURL *url = [NSURL URLWithString:uri];
    return url != nil ? [self decodeImageFromURL:url] : nil;
  }
  if ([uri hasPrefix:@"data:image/"]) {
    NSRange comma = [uri rangeOfString:@","];
    if (comma.location == NSNotFound) return nil;
    NSString *payload = [uri substringFromIndex:comma.location + 1];
    NSData *data = [[NSData alloc] initWithBase64EncodedString:payload options:NSDataBase64DecodingIgnoreUnknownCharacters];
    return data.length ? [self decodeImageFromData:data] : nil;
  }
  if ([uri hasPrefix:@"http://"] || [uri hasPrefix:@"https://"]) {
    NSURL *url = [NSURL URLWithString:uri];
    if (url == nil) return nil;
    NSData *data = [NSData dataWithContentsOfURL:url options:NSDataReadingMappedIfSafe error:nil];
    return data.length ? [self decodeImageFromData:data] : nil;
  }
  return [self decodeImageFromURL:[NSURL fileURLWithPath:uri]];
}

- (nullable UIImage *)decodeImageFromURL:(NSURL *)url
{
  if (url == nil) return nil;
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, (__bridge CFDictionaryRef)@{(NSString *)kCGImageSourceShouldCache: @NO});
  if (source == NULL) return nil;
  NSDictionary *options = @{
    (NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
    (NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
    (NSString *)kCGImageSourceShouldCacheImmediately: @YES,
    (NSString *)kCGImageSourceThumbnailMaxPixelSize: @((NSInteger)BsnPdfMaxDecodedImagePixel),
  };
  CGImageRef cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (cgImage == NULL) return nil;
  UIImage *image = [UIImage imageWithCGImage:cgImage scale:UIScreen.mainScreen.scale orientation:UIImageOrientationUp];
  CGImageRelease(cgImage);
  return image;
}

- (nullable UIImage *)decodeImageFromData:(NSData *)data
{
  if (data.length == 0) return nil;
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, (__bridge CFDictionaryRef)@{(NSString *)kCGImageSourceShouldCache: @NO});
  if (source == NULL) return nil;
  NSDictionary *options = @{
    (NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
    (NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
    (NSString *)kCGImageSourceShouldCacheImmediately: @YES,
    (NSString *)kCGImageSourceThumbnailMaxPixelSize: @((NSInteger)BsnPdfMaxDecodedImagePixel),
  };
  CGImageRef cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (cgImage == NULL) return [UIImage imageWithData:data];
  UIImage *image = [UIImage imageWithCGImage:cgImage scale:UIScreen.mainScreen.scale orientation:UIImageOrientationUp];
  CGImageRelease(cgImage);
  return image;
}

- (nullable UIImage *)imageForAnnotation:(NSDictionary *)annotation dirtyRect:(CGRect)dirtyRect
{
  NSString *key = [self imageCacheKeyForAnnotation:annotation];
  if (key.length == 0) return nil;
  UIImage *cached = self.imageAnnotationCache[key];
  if (cached != nil) return cached;
  if ([self.imageAnnotationLoadsInFlight containsObject:key]) return nil;

  NSString *uri = [RCTConvert NSString:annotation[@"uri"]];
  if (uri.length == 0) return nil;
  [self.imageAnnotationLoadsInFlight addObject:key];
  __weak typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    UIImage *image = [weakSelf decodeImageFromUri:uri];
    dispatch_async(dispatch_get_main_queue(), ^{
      BsnPdfViewportView *strongSelf = weakSelf;
      if (strongSelf == nil) return;
      if (image != nil) strongSelf.imageAnnotationCache[key] = image;
      [strongSelf.imageAnnotationLoadsInFlight removeObject:key];
      if (!CGRectIsNull(dirtyRect) && !CGRectIsEmpty(dirtyRect)) {
        [strongSelf setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
      }
    });
  });
  return nil;
}

- (void)drawImageAnnotationsForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  NSArray<NSDictionary *> *annotations = [self.imageAnnotations isKindOfClass:NSArray.class] ? self.imageAnnotations : @[];
  if (annotations.count == 0) return;
  NSArray<NSDictionary *> *sortedAnnotations = [annotations sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    NSInteger leftZ = left[@"zIndex"] != nil ? [left[@"zIndex"] integerValue] : 0;
    NSInteger rightZ = right[@"zIndex"] != nil ? [right[@"zIndex"] integerValue] : 0;
    if (leftZ == rightZ) return NSOrderedSame;
    return leftZ < rightZ ? NSOrderedAscending : NSOrderedDescending;
  }];

  for (NSDictionary *annotation in sortedAnnotations) {
    if (![self imageAnnotation:annotation belongsToLayout:layout]) continue;
    CGRect rect = [self rectForImageAnnotation:annotation layout:layout];
    if (CGRectIsEmpty(rect) || CGRectIsNull(rect)) continue;
    UIImage *image = [self imageForAnnotation:annotation dirtyRect:CGRectInset(rect, -4.0, -4.0)];
    CGFloat opacity = annotation[@"opacity"] != nil ? MIN(1.0, MAX(0.05, [annotation[@"opacity"] doubleValue])) : 1.0;
    CGFloat rotation = annotation[@"rotation"] != nil ? [annotation[@"rotation"] doubleValue] : 0.0;

    CGContextSaveGState(context);
    CGContextClipToRect(context, layout.frame);
    if (fabs(rotation) > 0.01) {
      CGPoint center = CGPointMake(CGRectGetMidX(rect), CGRectGetMidY(rect));
      CGContextTranslateCTM(context, center.x, center.y);
      CGContextRotateCTM(context, rotation * M_PI / 180.0);
      rect = CGRectMake(-rect.size.width * 0.5, -rect.size.height * 0.5, rect.size.width, rect.size.height);
    }

    if (image != nil) {
      [image drawInRect:rect blendMode:kCGBlendModeNormal alpha:opacity];
    } else {
      UIColor *fill = [UIColor colorWithWhite:0.94 alpha:0.9];
      UIColor *stroke = [UIColor colorWithWhite:0.74 alpha:0.9];
      CGContextSetFillColorWithColor(context, fill.CGColor);
      CGContextFillRect(context, rect);
      CGContextSetStrokeColorWithColor(context, stroke.CGColor);
      CGContextSetLineWidth(context, 1.0 / MAX(1.0, [self viewportScale]));
      CGContextStrokeRect(context, rect);
    }
    CGContextRestoreGState(context);
  }
}

- (NSArray<NSDictionary *> *)visibleInkStrokesIncludingPending
{
  NSString *retainedStyle = [RCTConvert NSString:self.retainedLiveStroke[@"style"]];
  NSString *hiddenRetainedHighlightId = [retainedStyle isEqualToString:@"highlight"]
    ? [RCTConvert NSString:self.retainedLiveStroke[@"id"]]
    : nil;
  NSMutableArray<NSDictionary *> *strokes = [NSMutableArray array];
  for (NSDictionary *stroke in self.inkStrokes ?: @[]) {
    NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
    if (hiddenRetainedHighlightId.length > 0 && [strokeId isEqualToString:hiddenRetainedHighlightId]) continue;
    [strokes addObject:stroke];
  }
  if (self.pendingCommittedStrokes.count > 0) {
    NSMutableSet<NSString *> *visibleIds = [NSMutableSet set];
    for (NSDictionary *stroke in strokes) {
      NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
      if (strokeId.length > 0) [visibleIds addObject:strokeId];
    }
    for (NSDictionary *pendingStroke in self.pendingCommittedStrokes) {
      NSString *pendingStrokeId = [RCTConvert NSString:pendingStroke[@"id"]];
      if (hiddenRetainedHighlightId.length > 0 && [pendingStrokeId isEqualToString:hiddenRetainedHighlightId]) continue;
      if (pendingStrokeId.length > 0 && [visibleIds containsObject:pendingStrokeId]) continue;
      if (pendingStrokeId.length > 0) [visibleIds addObject:pendingStrokeId];
      [strokes addObject:pendingStroke];
    }
  }
  return [strokes copy];
}

- (void)drawInkForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  NSArray<NSDictionary *> *strokes = [self visibleInkStrokesIncludingPending];
  BOOL previewActive = [self selectionPreviewAppliesToLayout:layout];
  NSMutableArray<NSDictionary *> *previewStrokes = previewActive ? [NSMutableArray array] : nil;
  for (NSDictionary *stroke in strokes) {
    if (![self stroke:stroke belongsToLayout:layout]) continue;
    if (previewActive && [self strokeIsInSelectionPreview:stroke]) {
      NSDictionary *previewStroke = [self selectionPreviewStrokeFromStroke:stroke];
      if (previewStroke != nil) [previewStrokes addObject:previewStroke];
      continue;
    }
    [self drawStroke:stroke layout:layout context:context];
  }
  for (NSDictionary *stroke in previewStrokes) {
    [self drawStroke:stroke layout:layout context:context];
  }
}

- (BOOL)selectionPreviewAppliesToLayout:(BsnPdfPageLayout *)layout
{
  if (self.selectionPreviewStrokeIdSet.count == 0) return NO;
  if (fabs(self.selectionPreviewOffsetX) < 0.01 && fabs(self.selectionPreviewOffsetY) < 0.01) return NO;
  if (self.selectionPreviewGeneratedPageId.length > 0) {
    return layout.generatedPageId != nil && [layout.generatedPageId isEqualToString:self.selectionPreviewGeneratedPageId];
  }
  return self.selectionPreviewPageNumber > 0
    && layout.pageNumber != nil
    && layout.pageNumber.integerValue == self.selectionPreviewPageNumber;
}

- (BOOL)strokeIsInSelectionPreview:(NSDictionary *)stroke
{
  NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
  return strokeId.length > 0 && [self.selectionPreviewStrokeIdSet containsObject:strokeId];
}

- (NSDictionary *)selectionPreviewStrokeFromStroke:(NSDictionary *)stroke
{
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return nil;
  NSMutableArray<NSDictionary *> *translatedPoints = [NSMutableArray arrayWithCapacity:points.count];
  for (NSDictionary *point in points) {
    NSMutableDictionary *nextPoint = [point mutableCopy];
    nextPoint[@"x"] = @([point[@"x"] doubleValue] + self.selectionPreviewOffsetX);
    nextPoint[@"y"] = @([point[@"y"] doubleValue] + self.selectionPreviewOffsetY);
    [translatedPoints addObject:nextPoint];
  }
  NSMutableDictionary *nextStroke = [stroke mutableCopy];
  nextStroke[@"points"] = translatedPoints;
  return nextStroke;
}

- (CGRect)selectionPreviewDirtyRectWithOffsetX:(CGFloat)offsetX y:(CGFloat)offsetY
{
  if (self.selectionPreviewStrokeIdSet.count == 0) return CGRectNull;
  CGRect dirtyRect = CGRectNull;
  CGFloat savedOffsetX = self.selectionPreviewOffsetX;
  CGFloat savedOffsetY = self.selectionPreviewOffsetY;
  _selectionPreviewOffsetX = offsetX;
  _selectionPreviewOffsetY = offsetY;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (![self selectionPreviewAppliesToLayout:layout]) continue;
    for (NSDictionary *stroke in self.inkStrokes) {
      if (![self stroke:stroke belongsToLayout:layout] || ![self strokeIsInSelectionPreview:stroke]) continue;
      dirtyRect = CGRectUnion(dirtyRect, [self dirtyRectForStroke:stroke]);
      NSDictionary *previewStroke = [self selectionPreviewStrokeFromStroke:stroke];
      if (previewStroke != nil) dirtyRect = CGRectUnion(dirtyRect, [self dirtyRectForStroke:previewStroke]);
    }
  }
  _selectionPreviewOffsetX = savedOffsetX;
  _selectionPreviewOffsetY = savedOffsetY;
  return dirtyRect;
}

- (void)drawSelectionOverlayForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  if (![self selectionOverlayAppliesToLayout:layout]) return;
  CGRect rect = [self selectionOverlayRectForLayout:layout];
  if (CGRectIsEmpty(rect) || CGRectIsNull(rect)) return;

  CGContextSaveGState(context);
  UIColor *strokeColor = [UIColor colorWithRed:0.15 green:0.39 blue:0.92 alpha:self.selectionOverlayDraft ? 0.88 : 0.96];
  UIColor *fillColor = [UIColor colorWithRed:0.31 green:0.55 blue:1.0 alpha:self.selectionOverlayDraft ? 0.05 : 0.08];
  CGFloat zoom = MAX(1.0, [self viewportScale]);
  CGFloat lineWidth = 2.0 / zoom;
  CGFloat dash[] = { 7.0 / zoom, 5.0 / zoom };

  if ([self.selectionOverlayMode isEqualToString:@"lasso"]) {
    NSArray *path = [self.selectionOverlayPath isKindOfClass:NSArray.class] ? self.selectionOverlayPath : @[];
    if (path.count > 1) {
      CGFloat pageWidth = MAX(1.0, self.selectionOverlayPageWidth);
      CGFloat pageHeight = MAX(1.0, self.selectionOverlayPageHeight);
      BOOL closePath = !self.selectionOverlayDraft && path.count > 2;
      CGContextBeginPath(context);
      for (NSUInteger index = 0; index < path.count; index += 1) {
        NSDictionary *point = path[index];
        CGFloat x = layout.frame.origin.x + [point[@"x"] doubleValue] / pageWidth * layout.frame.size.width;
        CGFloat y = layout.frame.origin.y + [point[@"y"] doubleValue] / pageHeight * layout.frame.size.height;
        if (index == 0) CGContextMoveToPoint(context, x, y);
        else CGContextAddLineToPoint(context, x, y);
      }
      if (closePath) {
        CGContextClosePath(context);
        CGContextSetFillColorWithColor(context, fillColor.CGColor);
        CGContextFillPath(context);
      }
      CGContextBeginPath(context);
      for (NSUInteger index = 0; index < path.count; index += 1) {
        NSDictionary *point = path[index];
        CGFloat x = layout.frame.origin.x + [point[@"x"] doubleValue] / pageWidth * layout.frame.size.width;
        CGFloat y = layout.frame.origin.y + [point[@"y"] doubleValue] / pageHeight * layout.frame.size.height;
        if (index == 0) CGContextMoveToPoint(context, x, y);
        else CGContextAddLineToPoint(context, x, y);
      }
      if (closePath) CGContextClosePath(context);
      CGContextSetStrokeColorWithColor(context, strokeColor.CGColor);
      CGContextSetLineWidth(context, lineWidth);
      CGContextSetLineDash(context, 0, dash, 2);
      CGContextSetLineCap(context, kCGLineCapRound);
      CGContextSetLineJoin(context, kCGLineJoinRound);
      CGContextStrokePath(context);
    }
    CGContextRestoreGState(context);
    return;
  }

  CGContextSetFillColorWithColor(context, fillColor.CGColor);
  CGContextFillRect(context, rect);
  CGContextSetStrokeColorWithColor(context, strokeColor.CGColor);
  CGContextSetLineWidth(context, lineWidth);
  CGContextSetLineDash(context, 0, dash, 2);
  CGContextStrokeRect(context, rect);
  CGContextSetLineDash(context, 0, NULL, 0);

  CGFloat handleSize = 14.0 / zoom;
  CGFloat halfHandle = handleSize * 0.5;
  NSArray<NSValue *> *points = @[
    [NSValue valueWithCGPoint:CGPointMake(CGRectGetMinX(rect), CGRectGetMinY(rect))],
    [NSValue valueWithCGPoint:CGPointMake(CGRectGetMaxX(rect), CGRectGetMinY(rect))],
    [NSValue valueWithCGPoint:CGPointMake(CGRectGetMinX(rect), CGRectGetMaxY(rect))],
    [NSValue valueWithCGPoint:CGPointMake(CGRectGetMaxX(rect), CGRectGetMaxY(rect))],
  ];
  for (NSValue *value in points) {
    CGPoint point = value.CGPointValue;
    CGRect handleRect = CGRectMake(point.x - halfHandle, point.y - halfHandle, handleSize, handleSize);
    CGContextSetFillColorWithColor(context, UIColor.whiteColor.CGColor);
    CGContextFillEllipseInRect(context, handleRect);
    CGContextSetStrokeColorWithColor(context, strokeColor.CGColor);
    CGContextSetLineWidth(context, 2.0 / zoom);
    CGContextStrokeEllipseInRect(context, handleRect);
  }
  CGContextRestoreGState(context);
}

- (void)drawSelectionMenuForLayout:(BsnPdfPageLayout *)layout inContext:(CGContextRef)context
{
  if (!self.selectionMenuEnabled || self.selectionOverlayDraft || ![self selectionOverlayAppliesToLayout:layout]) return;
  CGRect menuRect = [self selectionMenuRectForLayout:layout];
  if (CGRectIsEmpty(menuRect) || CGRectIsNull(menuRect)) return;
  CGFloat zoom = MAX(1.0, [self viewportScale]);
  CGFloat radius = 13.0 / zoom;
  CGContextSaveGState(context);
  UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:menuRect cornerRadius:radius];
  CGContextSetShadowWithColor(context, CGSizeMake(0, 6.0 / zoom), 12.0 / zoom, [UIColor colorWithWhite:0 alpha:0.18].CGColor);
  [[UIColor colorWithRed:0.12 green:0.13 blue:0.15 alpha:0.92] setFill];
  [path fill];
  CGContextSetShadowWithColor(context, CGSizeZero, 0, nil);

  NSArray<NSString *> *symbols = [self selectionMenuSymbols];
  CGFloat button = 40.0 / zoom;
  CGFloat gap = 10.0 / zoom;
  CGFloat paddingX = 12.0 / zoom;
  CGFloat paddingY = 8.0 / zoom;
  CGFloat x = CGRectGetMinX(menuRect) + paddingX;
  CGFloat y = CGRectGetMinY(menuRect) + paddingY;
  for (NSString *symbol in symbols) {
    CGRect buttonRect = CGRectMake(x, y, button, button);
    UIColor *buttonColor = [symbol isEqualToString:@"sparkles"]
      ? [UIColor colorWithRed:0.32 green:0.45 blue:1.0 alpha:1.0]
      : [symbol isEqualToString:@"trash"]
        ? [UIColor colorWithRed:0.95 green:0.22 blue:0.22 alpha:1.0]
        : [UIColor colorWithWhite:1.0 alpha:0.12];
    CGContextSetFillColorWithColor(context, buttonColor.CGColor);
    CGContextFillEllipseInRect(context, buttonRect);
    [self drawMenuSymbol:symbol inRect:CGRectInset(buttonRect, 10.0 / zoom, 10.0 / zoom) color:UIColor.whiteColor];
    x += button + gap;
  }

  if (self.selectionMenuEditable && self.selectionColorPickerOpen) {
    NSArray<NSString *> *colors = @[@"#111827", @"#E11D48", @"#F97316", @"#FDE047", @"#22C55E", @"#2563EB", @"#7C3AED"];
    CGFloat dot = 20.0 / zoom;
    CGFloat dotGap = 8.0 / zoom;
    CGFloat dotX = CGRectGetMinX(menuRect) + paddingX;
    CGFloat dotY = CGRectGetMinY(menuRect) + paddingY * 2.0 + button + 7.0 / zoom;
    for (NSString *hex in colors) {
      CGRect dotRect = CGRectMake(dotX, dotY, dot, dot);
      CGContextSetFillColorWithColor(context, [self colorFromHex:hex].CGColor);
      CGContextFillEllipseInRect(context, dotRect);
      CGContextSetStrokeColorWithColor(context, [UIColor colorWithWhite:1 alpha:0.82].CGColor);
      CGContextSetLineWidth(context, 1.2 / zoom);
      CGContextStrokeEllipseInRect(context, dotRect);
      dotX += dot + dotGap;
    }
  }
  CGContextRestoreGState(context);
}

- (void)drawMenuSymbol:(NSString *)symbolName inRect:(CGRect)rect color:(UIColor *)color
{
  UIImage *image = nil;
  if (@available(iOS 13.0, *)) {
    UIImageSymbolConfiguration *configuration = [UIImageSymbolConfiguration configurationWithPointSize:MAX(11.0, rect.size.height) weight:UIImageSymbolWeightSemibold];
    image = [[UIImage systemImageNamed:symbolName withConfiguration:configuration] imageWithTintColor:color renderingMode:UIImageRenderingModeAlwaysOriginal];
  }
  if (image != nil) {
    [image drawInRect:rect];
    return;
  }
  NSDictionary *attrs = @{
    NSFontAttributeName: [UIFont systemFontOfSize:MAX(10.0, rect.size.height * 0.65) weight:UIFontWeightBold],
    NSForegroundColorAttributeName: color,
  };
  NSString *fallback = [symbolName isEqualToString:@"trash"] ? @"D" : ([symbolName isEqualToString:@"doc.on.doc"] ? @"C" : ([symbolName isEqualToString:@"paintpalette"] ? @"P" : @"AI"));
  CGSize size = [fallback sizeWithAttributes:attrs];
  [fallback drawAtPoint:CGPointMake(CGRectGetMidX(rect) - size.width * 0.5, CGRectGetMidY(rect) - size.height * 0.5) withAttributes:attrs];
}

- (BOOL)selectionOverlayAppliesToLayout:(BsnPdfPageLayout *)layout
{
  if (self.selectionOverlayWidth <= 0 || self.selectionOverlayHeight <= 0) return NO;
  if (self.selectionOverlayGeneratedPageId.length > 0) {
    return layout.generatedPageId != nil && [layout.generatedPageId isEqualToString:self.selectionOverlayGeneratedPageId];
  }
  return self.selectionOverlayPageNumber > 0
    && layout.pageNumber != nil
    && layout.pageNumber.integerValue == self.selectionOverlayPageNumber;
}

- (CGRect)selectionOverlayRectForLayout:(BsnPdfPageLayout *)layout
{
  CGFloat pageWidth = MAX(1.0, self.selectionOverlayPageWidth);
  CGFloat pageHeight = MAX(1.0, self.selectionOverlayPageHeight);
  CGFloat x = layout.frame.origin.x + self.selectionOverlayX / pageWidth * layout.frame.size.width;
  CGFloat y = layout.frame.origin.y + self.selectionOverlayY / pageHeight * layout.frame.size.height;
  CGFloat width = self.selectionOverlayWidth / pageWidth * layout.frame.size.width;
  CGFloat height = self.selectionOverlayHeight / pageHeight * layout.frame.size.height;
  return CGRectMake(x, y, width, height);
}

- (CGRect)selectionMenuRectForLayout:(BsnPdfPageLayout *)layout
{
  CGFloat zoom = MAX(0.0001, [self viewportScale]);
  NSArray<NSString *> *symbols = [self selectionMenuSymbols];
  CGFloat button = 40.0 / zoom;
  CGFloat gap = 10.0 / zoom;
  CGFloat paddingX = 12.0 / zoom;
  CGFloat paddingY = 8.0 / zoom;
  CGFloat margin = 8.0 / zoom;
  CGFloat gapCount = symbols.count > 1 ? (CGFloat)(symbols.count - 1) : 0.0;
  CGFloat menuWidth = paddingX * 2.0 + symbols.count * button + gapCount * gap;
  CGFloat menuHeight = paddingY * 2.0 + button;
  if (self.selectionMenuEditable && self.selectionColorPickerOpen) {
    menuHeight += 35.0 / zoom;
  }

  CGRect selectionRect = [self selectionOverlayRectForLayout:layout];
  CGFloat preferredTop = CGRectGetMinY(selectionRect) - menuHeight - 10.0 / zoom;
  if (preferredTop < CGRectGetMinY(layout.frame) + margin) {
    preferredTop = CGRectGetMaxY(selectionRect) + 10.0 / zoom;
  }
  CGFloat maxLeft = CGRectGetMaxX(layout.frame) - menuWidth - margin;
  CGFloat maxTop = CGRectGetMaxY(layout.frame) - menuHeight - margin;
  CGFloat left = MIN(MAX(CGRectGetMinX(layout.frame) + margin, CGRectGetMidX(selectionRect) - menuWidth * 0.5), MAX(CGRectGetMinX(layout.frame) + margin, maxLeft));
  CGFloat top = MIN(MAX(CGRectGetMinY(layout.frame) + margin, preferredTop), MAX(CGRectGetMinY(layout.frame) + margin, maxTop));
  return CGRectMake(left, top, menuWidth, menuHeight);
}

- (NSArray<NSString *> *)selectionMenuSymbols
{
  return self.selectionMenuEditable ? @[@"sparkles", @"doc.on.doc", @"paintpalette", @"trash"] : @[@"sparkles"];
}

- (nullable NSDictionary *)selectionMenuActionAtViewPoint:(CGPoint)viewPoint
{
  if (!self.selectionMenuEnabled || self.selectionOverlayDraft) return nil;
  CGFloat zoom = MAX(1.0, [self viewportScale]);
  CGPoint contentPoint = [self contentPointForViewportPoint:viewPoint];
  CGFloat button = 40.0 / zoom;
  CGFloat gap = 10.0 / zoom;
  CGFloat paddingX = 12.0 / zoom;
  CGFloat paddingY = 8.0 / zoom;
  CGFloat hitSlop = 10.0 / zoom;
  NSArray<NSString *> *actions = self.selectionMenuEditable
    ? @[@"askAi", @"duplicate", @"palette", @"delete"]
    : @[@"askAi"];

  for (BsnPdfPageLayout *layout in self.layouts) {
    if (![self selectionOverlayAppliesToLayout:layout]) continue;
    CGRect menuRect = [self selectionMenuRectForLayout:layout];
    if (!CGRectContainsPoint(CGRectInset(menuRect, -hitSlop, -hitSlop), contentPoint)) continue;
    NSString *pageId = layout.pageId ?: @"page";
    CGFloat buttonY = CGRectGetMinY(menuRect) + paddingY;
    for (NSUInteger index = 0; index < actions.count; index += 1) {
      CGFloat buttonX = CGRectGetMinX(menuRect) + paddingX + (button + gap) * index;
      CGRect buttonRect = CGRectInset(CGRectMake(buttonX, buttonY, button, button), -hitSlop, -hitSlop);
      if (CGRectContainsPoint(buttonRect, contentPoint)) {
        return @{@"action": actions[index], @"pageId": pageId};
      }
    }

    if (self.selectionMenuEditable && self.selectionColorPickerOpen) {
      NSArray<NSString *> *colors = @[@"#111827", @"#E11D48", @"#F97316", @"#FDE047", @"#22C55E", @"#2563EB", @"#7C3AED"];
      CGFloat dot = 20.0 / zoom;
      CGFloat dotGap = 8.0 / zoom;
      CGFloat dotX = CGRectGetMinX(menuRect) + paddingX;
      CGFloat dotY = CGRectGetMinY(menuRect) + paddingY * 2.0 + button + 7.0 / zoom;
      for (NSString *color in colors) {
        CGRect dotRect = CGRectInset(CGRectMake(dotX, dotY, dot, dot), -hitSlop, -hitSlop);
        if (CGRectContainsPoint(dotRect, contentPoint)) {
          return @{@"action": @"color", @"color": color, @"pageId": pageId};
        }
        dotX += dot + dotGap;
      }
    }
    return @{@"action": @"noop", @"pageId": pageId};
  }
  return nil;
}

- (void)setSelectionOverlayNeedsDisplay
{
  if (self.selectionOverlayWidth <= 0 || self.selectionOverlayHeight <= 0) {
    return;
  }
  CGRect dirtyRect = CGRectNull;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (![self selectionOverlayAppliesToLayout:layout]) continue;
    CGRect rect = [self selectionOverlayRectForLayout:layout];
    CGFloat padding = MAX(44.0, 36.0 / MAX(1.0, [self viewportScale]));
    dirtyRect = CGRectUnion(dirtyRect, CGRectInset(rect, -padding, -padding));
    if (self.selectionMenuEnabled) dirtyRect = CGRectUnion(dirtyRect, CGRectInset([self selectionMenuRectForLayout:layout], -padding, -padding));
  }
  if (!CGRectIsNull(dirtyRect) && !CGRectIsEmpty(dirtyRect)) {
    [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
  }
}

- (nullable BsnPdfPageLayout *)layoutForTextAnnotation:(NSDictionary *)annotation
{
  NSString *generatedId = [RCTConvert NSString:annotation[@"generatedPageId"]];
  NSNumber *pageNumber = annotation[@"pageNumber"] != nil ? [RCTConvert NSNumber:annotation[@"pageNumber"]] : nil;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (generatedId.length > 0) {
      if (layout.generatedPageId != nil && [layout.generatedPageId isEqualToString:generatedId]) return layout;
    } else if (layout.pageNumber != nil && pageNumber != nil && layout.pageNumber.integerValue == pageNumber.integerValue) {
      return layout;
    }
  }
  return nil;
}

- (CGRect)frameForTextAnnotation:(NSDictionary *)annotation layout:(BsnPdfPageLayout *)layout
{
  CGFloat pageWidth = MAX(1.0, annotation[@"pageWidth"] != nil ? [annotation[@"pageWidth"] doubleValue] : layout.logicalSize.width);
  CGFloat pageHeight = MAX(1.0, annotation[@"pageHeight"] != nil ? [annotation[@"pageHeight"] doubleValue] : layout.logicalSize.height);
  CGFloat x = layout.frame.origin.x + [annotation[@"x"] doubleValue] / pageWidth * layout.frame.size.width;
  CGFloat y = layout.frame.origin.y + [annotation[@"y"] doubleValue] / pageHeight * layout.frame.size.height;
  CGFloat width = MAX(38.0, [annotation[@"width"] doubleValue] / pageWidth * layout.frame.size.width);
  CGFloat height = MAX(28.0, (annotation[@"height"] != nil ? [annotation[@"height"] doubleValue] : 56.0) / pageHeight * layout.frame.size.height);
  return CGRectMake(x, y, width, height);
}

- (void)updateTextAnnotationViews
{
  if (self.contentView == nil) return;
  UIView *container = self.customViewportCoreEnabled ? self.customNativeSubviewLayer : self.contentView;
  NSMutableSet<NSString *> *seenIds = [NSMutableSet set];
  for (NSDictionary *annotation in self.textAnnotations ?: @[]) {
    NSString *annotationId = [RCTConvert NSString:annotation[@"id"]];
    if (annotationId.length == 0) continue;
    if ([RCTConvert NSString:annotation[@"generatedPageId"]].length > 0) continue;
    BsnPdfPageLayout *layout = [self layoutForTextAnnotation:annotation];
    if (layout == nil) continue;
    [seenIds addObject:annotationId];
    BsnPdfTextAnnotationView *host = self.textAnnotationViews[annotationId];
    BOOL isNew = host == nil;
    if (host == nil) {
      host = [[BsnPdfTextAnnotationView alloc] initWithOwner:self annotationId:annotationId];
      self.textAnnotationViews[annotationId] = host;
      [container addSubview:host];
    } else if (host.superview != container) {
      [container addSubview:host];
    }
    host.hidden = [self.hiddenTextAnnotationIdSet containsObject:annotationId];
    CGRect contentFrame = [self frameForTextAnnotation:annotation layout:layout];
    host.frame = self.customViewportCoreEnabled ? [self rawViewportRectForContentRect:contentFrame] : contentFrame;
    NSString *text = [RCTConvert NSString:annotation[@"text"]] ?: @"";
    if (![host.textView.text isEqualToString:text] && !host.textView.isFirstResponder) host.textView.text = text;
    CGFloat fontSize = annotation[@"fontSize"] != nil ? [annotation[@"fontSize"] doubleValue] : 17.0;
    CGFloat scale = host.frame.size.width / MAX(1.0, [annotation[@"width"] doubleValue]);
    CGFloat displayFontSize = MAX(8.0, MIN(80.0, fontSize * scale));
    host.textView.font = [UIFont systemFontOfSize:displayFontSize weight:UIFontWeightRegular];
    host.textView.textColor = [self colorFromHex:[RCTConvert NSString:annotation[@"color"]] ?: @"#111827"];
    [host setActive:[self.activeTextAnnotationId isEqualToString:annotationId]];
    [host setNeedsLayout];
    if (isNew && text.length == 0) {
      [self activateTextAnnotationView:host focus:YES];
    }
  }
  NSArray<NSString *> *existingIds = self.textAnnotationViews.allKeys;
  for (NSString *annotationId in existingIds) {
    if ([seenIds containsObject:annotationId]) continue;
    [self.textAnnotationViews[annotationId] removeFromSuperview];
    [self.textAnnotationViews removeObjectForKey:annotationId];
  }
}

- (NSString *)pageReferencePageKey:(NSDictionary *)reference
{
  if (![reference isKindOfClass:NSDictionary.class]) return @"unknown";
  NSDictionary *page = [reference[@"page"] isKindOfClass:NSDictionary.class] ? reference[@"page"] : @{};
  NSString *generatedPageId = [RCTConvert NSString:page[@"generatedPageId"]];
  if (generatedPageId.length > 0) return [NSString stringWithFormat:@"generated:%@", generatedPageId];
  NSNumber *pageNumber = [RCTConvert NSNumber:page[@"pageNumber"]];
  if (pageNumber.integerValue > 0) return [NSString stringWithFormat:@"pdf:%ld", (long)pageNumber.integerValue];
  return [RCTConvert NSString:reference[@"id"]] ?: @"unknown";
}

- (nullable BsnPdfPageLayout *)layoutForPageReference:(NSDictionary *)reference
{
  if (![reference isKindOfClass:NSDictionary.class]) return nil;
  NSDictionary *page = [reference[@"page"] isKindOfClass:NSDictionary.class] ? reference[@"page"] : @{};
  NSString *generatedPageId = [RCTConvert NSString:page[@"generatedPageId"]];
  NSNumber *pageNumber = [RCTConvert NSNumber:page[@"pageNumber"]];
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (generatedPageId.length > 0 && [layout.generatedPageId isEqualToString:generatedPageId]) return layout;
    if (pageNumber.integerValue > 0 && layout.pageNumber != nil && layout.pageNumber.integerValue == pageNumber.integerValue) return layout;
  }
  return nil;
}

- (NSString *)imageUriForPageReference:(NSDictionary *)reference
{
  if (![reference isKindOfClass:NSDictionary.class]) return @"";
  NSArray<NSString *> *keys = @[@"nativeImageUri", @"processedUrl", @"thumbnailUrl", @"fileUrl", @"previewImageKey"];
  for (NSString *key in keys) {
    NSString *uri = [RCTConvert NSString:reference[key]];
    if (uri.length > 0) return uri;
  }
  return @"";
}

- (nullable UIImage *)imageForPageReference:(NSDictionary *)reference
{
  NSString *uri = [self imageUriForPageReference:reference];
  if (uri.length == 0) return nil;
  NSString *referenceId = [RCTConvert NSString:reference[@"id"]] ?: @"reference";
  NSString *key = [NSString stringWithFormat:@"page-ref:%@:%@", referenceId, uri];
  UIImage *cached = self.imageAnnotationCache[key];
  if (cached != nil) return cached;
  if ([self.imageAnnotationLoadsInFlight containsObject:key]) return nil;

  [self.imageAnnotationLoadsInFlight addObject:key];
  __weak typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    UIImage *image = [weakSelf decodeImageFromUri:uri];
    dispatch_async(dispatch_get_main_queue(), ^{
      BsnPdfViewportView *strongSelf = weakSelf;
      if (strongSelf == nil) return;
      if (image != nil) strongSelf.imageAnnotationCache[key] = image;
      [strongSelf.imageAnnotationLoadsInFlight removeObject:key];
      [strongSelf updatePageReferenceViews];
    });
  });
  return nil;
}

- (void)updatePageReferenceViews
{
  if (self.contentView == nil) return;
  UIView *container = self.customViewportCoreEnabled ? self.customNativeSubviewLayer : self.contentView;
  NSArray<NSDictionary *> *references = [self.pageCaptureReferences isKindOfClass:NSArray.class] ? self.pageCaptureReferences : @[];
  NSMutableDictionary<NSString *, NSNumber *> *pageCounts = [NSMutableDictionary dictionary];
  for (NSDictionary *reference in references) {
    if (![reference isKindOfClass:NSDictionary.class]) continue;
    NSString *pageKey = [self pageReferencePageKey:reference];
    pageCounts[pageKey] = @((pageCounts[pageKey].integerValue) + 1);
  }

  NSMutableDictionary<NSString *, NSNumber *> *pageSlots = [NSMutableDictionary dictionary];
  NSMutableSet<NSString *> *seenIds = [NSMutableSet set];
  for (NSDictionary *reference in references) {
    if (![reference isKindOfClass:NSDictionary.class]) continue;
    NSString *referenceId = [RCTConvert NSString:reference[@"id"]];
    if (referenceId.length == 0) continue;
    BsnPdfPageLayout *layout = [self layoutForPageReference:reference];
    if (layout == nil) continue;

    NSString *pageKey = [self pageReferencePageKey:reference];
    NSInteger slot = pageSlots[pageKey].integerValue;
    pageSlots[pageKey] = @(slot + 1);
    NSInteger count = MAX(1, pageCounts[pageKey].integerValue);
    BOOL open = [self.openPageCaptureReferenceId isEqualToString:referenceId];

    BsnPdfPageReferenceView *host = self.pageReferenceViews[referenceId];
    if (host == nil) {
      host = [[BsnPdfPageReferenceView alloc] initWithOwner:self referenceId:referenceId];
      self.pageReferenceViews[referenceId] = host;
      [container addSubview:host];
    } else if (host.superview != container) {
      [container addSubview:host];
    }

    CGFloat margin = 14.0;
    CGFloat top = margin + slot * 38.0;
    CGFloat width = MIN(430.0, MAX(180.0, layout.frame.size.width - margin * 2.0));
    CGFloat availableHeight = MAX(170.0, layout.frame.size.height - top - margin);
    CGFloat height = open ? MIN(520.0, availableHeight) : 32.0;
    CGFloat x = CGRectGetMaxX(layout.frame) - margin - width;
    CGFloat y = layout.frame.origin.y + top;
    if (open && y + height > CGRectGetMaxY(layout.frame) - margin) {
      y = MAX(layout.frame.origin.y + margin, CGRectGetMaxY(layout.frame) - margin - height);
    }
    CGRect contentFrame = CGRectMake(x, y, width, height);
    host.frame = self.customViewportCoreEnabled ? [self rawViewportRectForContentRect:contentFrame] : contentFrame;
    [host configureWithReference:reference image:[self imageForPageReference:reference] count:count open:open];
    [seenIds addObject:referenceId];
    [container bringSubviewToFront:host];
  }

  NSArray<NSString *> *existingIds = self.pageReferenceViews.allKeys;
  for (NSString *referenceId in existingIds) {
    if ([seenIds containsObject:referenceId]) continue;
    [self.pageReferenceViews[referenceId] removeFromSuperview];
    [self.pageReferenceViews removeObjectForKey:referenceId];
  }
}

- (BsnPdfPageReferenceView *)pageReferenceViewFromSender:(id)sender
{
  UIView *view = [sender isKindOfClass:UIView.class] ? sender : nil;
  while (view != nil && ![view isKindOfClass:BsnPdfPageReferenceView.class]) view = view.superview;
  return (BsnPdfPageReferenceView *)view;
}

- (void)emitPageReferenceAction:(NSString *)action referenceId:(NSString *)referenceId
{
  if (referenceId.length == 0 || self.onPageCaptureReferenceAction == nil) return;
  self.onPageCaptureReferenceAction(@{@"action": action ?: @"toggle", @"referenceId": referenceId});
}

- (void)handlePageReferenceSticker:(id)sender
{
  [self emitPageReferenceAction:@"toggle" referenceId:[self pageReferenceViewFromSender:sender].referenceId];
}

- (void)handlePageReferenceClose:(id)sender
{
  [self emitPageReferenceAction:@"close" referenceId:[self pageReferenceViewFromSender:sender].referenceId];
}

- (void)handlePageReferenceAsk:(id)sender
{
  [self emitPageReferenceAction:@"askAi" referenceId:[self pageReferenceViewFromSender:sender].referenceId];
}

- (NSDictionary *)logicalTextFrameForHost:(BsnPdfTextAnnotationView *)host
{
  NSDictionary *annotation = self.textAnnotationById[host.annotationId];
  BsnPdfPageLayout *layout = annotation != nil ? [self layoutForTextAnnotation:annotation] : nil;
  if (annotation == nil || layout == nil) return @{};
  CGFloat pageWidth = MAX(1.0, annotation[@"pageWidth"] != nil ? [annotation[@"pageWidth"] doubleValue] : layout.logicalSize.width);
  CGFloat pageHeight = MAX(1.0, annotation[@"pageHeight"] != nil ? [annotation[@"pageHeight"] doubleValue] : layout.logicalSize.height);
  CGRect frame = host.frame;
  if (self.customViewportCoreEnabled) {
    CGFloat zoom = [self viewportScale];
    CGPoint contentOrigin = [self contentPointForViewportPoint:frame.origin];
    frame = CGRectMake(contentOrigin.x, contentOrigin.y, frame.size.width / zoom, frame.size.height / zoom);
  }
  return @{
    @"x": @((frame.origin.x - layout.frame.origin.x) / MAX(1.0, layout.frame.size.width) * pageWidth),
    @"y": @((frame.origin.y - layout.frame.origin.y) / MAX(1.0, layout.frame.size.height) * pageHeight),
    @"width": @(frame.size.width / MAX(1.0, layout.frame.size.width) * pageWidth),
    @"height": @(frame.size.height / MAX(1.0, layout.frame.size.height) * pageHeight),
  };
}

- (nullable BsnPdfTextAnnotationView *)hostFromSender:(id)sender
{
  UIView *view = [sender isKindOfClass:UIView.class] ? sender : nil;
  while (view != nil && ![view isKindOfClass:BsnPdfTextAnnotationView.class]) view = view.superview;
  return (BsnPdfTextAnnotationView *)view;
}

- (void)activateTextAnnotationView:(BsnPdfTextAnnotationView *)host focus:(BOOL)focus
{
  if (host == nil) return;
  self.activeTextAnnotationId = host.annotationId;
  for (BsnPdfTextAnnotationView *item in self.textAnnotationViews.allValues) [item setActive:[item.annotationId isEqualToString:host.annotationId]];
  [host.superview bringSubviewToFront:host];
  if (focus) [host.textView becomeFirstResponder];
}

- (void)finishEditingTextAnnotationView:(BsnPdfTextAnnotationView *)host
{
  if (host == nil) return;
  [self resizeTextAnnotationViewToFitContent:host];
  if (self.onTextAnnotationChange != nil) {
    NSMutableDictionary *payload = [@{@"id": host.annotationId ?: @"", @"text": host.textView.text ?: @""} mutableCopy];
    NSDictionary *frame = [self logicalTextFrameForHost:host];
    if (frame[@"width"] != nil && frame[@"height"] != nil) {
      payload[@"width"] = frame[@"width"];
      payload[@"height"] = frame[@"height"];
    }
    self.onTextAnnotationChange(payload);
  }
  [host.textView resignFirstResponder];
  if ([self.activeTextAnnotationId isEqualToString:host.annotationId]) {
    self.activeTextAnnotationId = nil;
  }
  for (BsnPdfTextAnnotationView *item in self.textAnnotationViews.allValues) {
    [item setActive:NO];
  }
}

- (void)deactivateActiveTextAnnotationCommit:(BOOL)commit
{
  BsnPdfTextAnnotationView *host = self.activeTextAnnotationId.length > 0 ? self.textAnnotationViews[self.activeTextAnnotationId] : nil;
  if (host != nil) [self resizeTextAnnotationViewToFitContent:host];
  if (host != nil && commit && self.onTextAnnotationChange != nil) {
    NSMutableDictionary *payload = [@{@"id": host.annotationId ?: @"", @"text": host.textView.text ?: @""} mutableCopy];
    NSDictionary *frame = [self logicalTextFrameForHost:host];
    if (frame[@"width"] != nil && frame[@"height"] != nil) {
      payload[@"width"] = frame[@"width"];
      payload[@"height"] = frame[@"height"];
    }
    self.onTextAnnotationChange(payload);
  }
  if (host != nil) [host.textView resignFirstResponder];
  self.activeTextAnnotationId = nil;
  for (BsnPdfTextAnnotationView *item in self.textAnnotationViews.allValues) {
    [item setActive:NO];
  }
}

- (void)changeTextAnnotationFontForView:(BsnPdfTextAnnotationView *)host delta:(NSInteger)delta
{
  NSDictionary *annotation = self.textAnnotationById[host.annotationId];
  if (host == nil || annotation == nil || self.onTextAnnotationChange == nil) return;
  CGFloat current = annotation[@"fontSize"] != nil ? [annotation[@"fontSize"] doubleValue] : 17.0;
  CGFloat next = MIN(40.0, MAX(12.0, round(current + delta)));
  self.onTextAnnotationChange(@{@"id": host.annotationId ?: @"", @"fontSize": @(next)});
}

- (void)removeTextAnnotationView:(BsnPdfTextAnnotationView *)host
{
  if (host == nil) return;
  [host.textView resignFirstResponder];
  if ([self.activeTextAnnotationId isEqualToString:host.annotationId]) {
    self.activeTextAnnotationId = nil;
  }
  if (self.onTextAnnotationRemove != nil) self.onTextAnnotationRemove(@{@"id": host.annotationId ?: @""});
}

- (void)resizeTextAnnotationViewToFitContent:(BsnPdfTextAnnotationView *)host
{
  if (host == nil || host.textView == nil) return;
  NSDictionary *annotation = self.textAnnotationById[host.annotationId];
  BsnPdfPageLayout *layout = annotation != nil ? [self layoutForTextAnnotation:annotation] : nil;
  if (layout == nil || host.frame.size.width <= 0) return;
  CGSize targetSize = [host.textView sizeThatFits:CGSizeMake(host.bounds.size.width, CGFLOAT_MAX)];
  CGFloat minHeight = 34.0;
  CGRect layoutFrame = self.customViewportCoreEnabled ? [self rawViewportRectForContentRect:layout.frame] : layout.frame;
  CGFloat maxHeight = MAX(minHeight, CGRectGetMaxY(layoutFrame) - host.frame.origin.y);
  CGFloat nextHeight = MIN(maxHeight, MAX(minHeight, ceil(targetSize.height) + 2.0));
  if (fabs(nextHeight - host.frame.size.height) < 1.0) return;
  CGRect frame = host.frame;
  frame.size.height = nextHeight;
  host.frame = frame;
  [host setNeedsLayout];
}

- (void)handleTextAnnotationTap:(UITapGestureRecognizer *)gesture
{
  if (gesture.state != UIGestureRecognizerStateEnded) return;
  [self activateTextAnnotationView:(BsnPdfTextAnnotationView *)gesture.view focus:YES];
}

- (void)handleTextDoneButton:(id)sender { [self finishEditingTextAnnotationView:[self hostFromSender:sender] ?: self.textAnnotationViews[self.activeTextAnnotationId ?: @""]]; }
- (void)handleTextMinusButton:(id)sender { [self changeTextAnnotationFontForView:[self hostFromSender:sender] ?: self.textAnnotationViews[self.activeTextAnnotationId ?: @""] delta:-1]; }
- (void)handleTextPlusButton:(id)sender { [self changeTextAnnotationFontForView:[self hostFromSender:sender] ?: self.textAnnotationViews[self.activeTextAnnotationId ?: @""] delta:1]; }
- (void)handleTextDeleteButton:(id)sender { [self removeTextAnnotationView:[self hostFromSender:sender] ?: self.textAnnotationViews[self.activeTextAnnotationId ?: @""]]; }

- (void)handleTextAnnotationMovePan:(UIPanGestureRecognizer *)gesture
{
  BsnPdfTextAnnotationView *host = (BsnPdfTextAnnotationView *)gesture.view;
  if (![host isKindOfClass:BsnPdfTextAnnotationView.class]) return;
  NSDictionary *annotation = self.textAnnotationById[host.annotationId];
  BsnPdfPageLayout *layout = annotation != nil ? [self layoutForTextAnnotation:annotation] : nil;
  if (layout == nil) return;
  if (gesture.state == UIGestureRecognizerStateBegan) {
    [self activateTextAnnotationView:host focus:NO];
    [host.textView resignFirstResponder];
    host.startFrame = host.frame;
  } else if (gesture.state == UIGestureRecognizerStateChanged) {
    CGPoint translation = [gesture translationInView:self.customViewportCoreEnabled ? self : self.contentView];
    CGRect layoutFrame = self.customViewportCoreEnabled ? [self rawViewportRectForContentRect:layout.frame] : layout.frame;
    CGRect frame = host.startFrame;
    frame.origin.x = MIN(MAX(layoutFrame.origin.x, frame.origin.x + translation.x), CGRectGetMaxX(layoutFrame) - frame.size.width);
    frame.origin.y = MIN(MAX(layoutFrame.origin.y, frame.origin.y + translation.y), CGRectGetMaxY(layoutFrame) - frame.size.height);
    host.frame = frame;
  } else if (gesture.state == UIGestureRecognizerStateEnded || gesture.state == UIGestureRecognizerStateCancelled || gesture.state == UIGestureRecognizerStateFailed) {
    NSDictionary *frame = [self logicalTextFrameForHost:host];
    if (self.onTextAnnotationChange != nil && frame[@"x"] != nil && frame[@"y"] != nil) {
      self.onTextAnnotationChange(@{@"id": host.annotationId ?: @"", @"x": frame[@"x"], @"y": frame[@"y"]});
    }
  }
}

- (void)handleTextAnnotationResizePan:(UIPanGestureRecognizer *)gesture
{
  BsnPdfTextAnnotationView *host = (BsnPdfTextAnnotationView *)gesture.view.superview;
  if (![host isKindOfClass:BsnPdfTextAnnotationView.class]) return;
  NSDictionary *annotation = self.textAnnotationById[host.annotationId];
  BsnPdfPageLayout *layout = annotation != nil ? [self layoutForTextAnnotation:annotation] : nil;
  if (layout == nil) return;
  if (gesture.state == UIGestureRecognizerStateBegan) {
    [self activateTextAnnotationView:host focus:NO];
    [host.textView resignFirstResponder];
    host.startFrame = host.frame;
  } else if (gesture.state == UIGestureRecognizerStateChanged) {
    CGPoint translation = [gesture translationInView:self.customViewportCoreEnabled ? self : self.contentView];
    CGRect layoutFrame = self.customViewportCoreEnabled ? [self rawViewportRectForContentRect:layout.frame] : layout.frame;
    CGRect frame = host.startFrame;
    frame.size.width = MIN(MAX(44.0, frame.size.width + translation.x), CGRectGetMaxX(layoutFrame) - frame.origin.x);
    frame.size.height = MIN(MAX(30.0, frame.size.height + translation.y), CGRectGetMaxY(layoutFrame) - frame.origin.y);
    host.frame = frame;
    [host setNeedsLayout];
  } else if (gesture.state == UIGestureRecognizerStateEnded || gesture.state == UIGestureRecognizerStateCancelled || gesture.state == UIGestureRecognizerStateFailed) {
    NSDictionary *frame = [self logicalTextFrameForHost:host];
    if (self.onTextAnnotationChange != nil && frame[@"width"] != nil && frame[@"height"] != nil) {
      self.onTextAnnotationChange(@{@"id": host.annotationId ?: @"", @"width": frame[@"width"], @"height": frame[@"height"]});
    }
  }
}

- (void)textViewDidBeginEditing:(UITextView *)textView
{
  [self activateTextAnnotationView:(BsnPdfTextAnnotationView *)textView.superview focus:NO];
}

- (void)textViewDidChange:(UITextView *)textView
{
  BsnPdfTextAnnotationView *host = (BsnPdfTextAnnotationView *)textView.superview;
  if (![host isKindOfClass:BsnPdfTextAnnotationView.class]) return;
  [self resizeTextAnnotationViewToFitContent:host];
}

- (void)textViewDidEndEditing:(UITextView *)textView
{
  BsnPdfTextAnnotationView *host = (BsnPdfTextAnnotationView *)textView.superview;
  if (![host isKindOfClass:BsnPdfTextAnnotationView.class]) return;
  [self resizeTextAnnotationViewToFitContent:host];
  if (self.onTextAnnotationChange != nil) {
    NSMutableDictionary *payload = [@{@"id": host.annotationId ?: @"", @"text": textView.text ?: @""} mutableCopy];
    NSDictionary *frame = [self logicalTextFrameForHost:host];
    if (frame[@"width"] != nil && frame[@"height"] != nil) {
      payload[@"width"] = frame[@"width"];
      payload[@"height"] = frame[@"height"];
    }
    self.onTextAnnotationChange(payload);
  }
}

- (void)drawLiveInkInContext:(CGContextRef)context dirtyRect:(CGRect)dirtyRect
{
  NSDictionary *stroke = self.activePredictedStroke ?: self.activeStroke ?: self.retainedLiveStroke;
  if (stroke == nil) return;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if (![self stroke:stroke belongsToLayout:layout]) continue;
    if (!CGRectIntersectsRect(dirtyRect, layout.frame)) continue;
    [self drawStroke:stroke layout:layout context:context];
    return;
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

  if (points.count == 1) {
    CGPoint point = [self screenPointForInkPoint:points.firstObject layout:layout];
    CGContextMoveToPoint(context, point.x, point.y);
    CGContextAddLineToPoint(context, point.x + 0.01, point.y + 0.01);
    CGContextStrokePath(context);
    CGContextRestoreGState(context);
    return;
  }

  CGPoint first = [self screenPointForInkPoint:points.firstObject layout:layout];
  CGContextMoveToPoint(context, first.x, first.y);
  if (points.count == 2) {
    CGPoint end = [self screenPointForInkPoint:points.lastObject layout:layout];
    CGContextAddLineToPoint(context, end.x, end.y);
  } else {
    for (NSInteger index = 1; index < points.count - 1; index += 1) {
      CGPoint current = [self screenPointForInkPoint:points[index] layout:layout];
      CGPoint next = [self screenPointForInkPoint:points[index + 1] layout:layout];
      CGPoint mid = CGPointMake((current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
      CGContextAddQuadCurveToPoint(context, current.x, current.y, mid.x, mid.y);
    }
    CGPoint end = [self screenPointForInkPoint:points.lastObject layout:layout];
    CGContextAddLineToPoint(context, end.x, end.y);
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
  CGFloat radius = MAX(18.0, MAX(self.eraserWidth * 1.65, self.penWidth * 3.4));
  NSArray<NSDictionary *> *visibleStrokes = [self visibleInkStrokesIncludingPending];
  for (NSDictionary *stroke in visibleStrokes.reverseObjectEnumerator) {
    if (![self stroke:stroke belongsToLayout:layout]) continue;
    CGRect strokeBounds = [self logicalBoundsForStroke:stroke padding:radius + MAX(1.0, [stroke[@"width"] doubleValue])];
    CGRect eraserBounds = CGRectInset(CGRectMake([point[@"x"] doubleValue], [point[@"y"] doubleValue], 1.0, 1.0), -radius, -radius);
    if (!CGRectIsNull(strokeBounds) && !CGRectIntersectsRect(strokeBounds, eraserBounds)) continue;
    NSArray *points = stroke[@"points"];
    for (NSInteger index = 0; index < points.count; index += 1) {
      NSDictionary *candidate = points[index];
      CGFloat dx = [candidate[@"x"] doubleValue] - [point[@"x"] doubleValue];
      CGFloat dy = [candidate[@"y"] doubleValue] - [point[@"y"] doubleValue];
      if (hypot(dx, dy) <= radius) return [RCTConvert NSString:stroke[@"id"]];
      if (index > 0 && [self distanceFromPoint:point toSegmentStart:points[index - 1] end:candidate] <= radius) {
        return [RCTConvert NSString:stroke[@"id"]];
      }
    }
  }
  return nil;
}

- (BOOL)shouldProcessEraserPoint:(NSDictionary *)point force:(BOOL)force
{
  if (force || self.lastEraserPoint == nil) {
    self.lastEraserPoint = point;
    return YES;
  }
  CGFloat dx = [point[@"x"] doubleValue] - [self.lastEraserPoint[@"x"] doubleValue];
  CGFloat dy = [point[@"y"] doubleValue] - [self.lastEraserPoint[@"y"] doubleValue];
  CGFloat threshold = MIN(4.5, MAX(1.5, self.eraserWidth * 0.14));
  if (hypot(dx, dy) < threshold) return NO;
  self.lastEraserPoint = point;
  return YES;
}

- (CGRect)rawLogicalBoundsForStroke:(NSDictionary *)stroke
{
  NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
  if (strokeId.length > 0) {
    NSValue *cached = self.strokeBoundsCache[strokeId];
    if (cached != nil) return cached.CGRectValue;
  }
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return CGRectNull;
  CGFloat minX = CGFLOAT_MAX;
  CGFloat minY = CGFLOAT_MAX;
  CGFloat maxX = -CGFLOAT_MAX;
  CGFloat maxY = -CGFLOAT_MAX;
  for (NSDictionary *point in points) {
    CGFloat x = [point[@"x"] doubleValue];
    CGFloat y = [point[@"y"] doubleValue];
    minX = MIN(minX, x);
    minY = MIN(minY, y);
    maxX = MAX(maxX, x);
    maxY = MAX(maxY, y);
  }
  if (minX == CGFLOAT_MAX || minY == CGFLOAT_MAX || maxX == -CGFLOAT_MAX || maxY == -CGFLOAT_MAX) return CGRectNull;
  CGRect bounds = CGRectMake(minX, minY, MAX(1.0, maxX - minX), MAX(1.0, maxY - minY));
  if (strokeId.length > 0) self.strokeBoundsCache[strokeId] = [NSValue valueWithCGRect:bounds];
  return bounds;
}

- (CGRect)logicalBoundsForStroke:(NSDictionary *)stroke padding:(CGFloat)padding
{
  CGRect bounds = [self rawLogicalBoundsForStroke:stroke];
  if (CGRectIsNull(bounds)) return CGRectNull;
  return CGRectInset(bounds, -padding, -padding);
}

- (void)resetStrokeBoundsCache
{
  [self.strokeBoundsCache removeAllObjects];
}

- (void)beginPartialEraseIfNeeded
{
  if (self.eraserOriginalStrokeIds != nil) return;
  NSMutableSet<NSString *> *ids = [NSMutableSet set];
  for (NSDictionary *stroke in self.inkStrokes) {
    NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
    if (strokeId.length > 0) [ids addObject:strokeId];
  }
  self.eraserOriginalStrokeIds = [ids copy];
}

- (void)endPartialEraseWithCommit:(BOOL)commit
{
  NSSet<NSString *> *originalIds = self.eraserOriginalStrokeIds;
  self.eraserOriginalStrokeIds = nil;
  if (!commit || originalIds == nil) return;

  NSMutableSet<NSString *> *currentIds = [NSMutableSet set];
  NSMutableArray<NSDictionary *> *addedStrokes = [NSMutableArray array];
  for (NSDictionary *stroke in self.inkStrokes) {
    NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
    if (strokeId.length > 0) [currentIds addObject:strokeId];
    if (strokeId.length > 0 && ![originalIds containsObject:strokeId]) [addedStrokes addObject:stroke];
  }

  NSMutableArray<NSString *> *removedIds = [NSMutableArray array];
  for (NSString *strokeId in originalIds) {
    if (![currentIds containsObject:strokeId]) [removedIds addObject:strokeId];
  }

  if ((removedIds.count > 0 || addedStrokes.count > 0) && self.onReplaceInkStrokes != nil) {
    for (NSString *strokeId in removedIds) {
      if (strokeId.length > 0) [self.pendingRemovedStrokeIds addObject:strokeId];
    }
    for (NSDictionary *stroke in addedStrokes) {
      NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
      if (strokeId.length > 0) [self.pendingCommittedStrokes addObject:[stroke copy]];
    }
    self.onReplaceInkStrokes(@{
      @"removedStrokeIds": removedIds,
      @"addedStrokes": addedStrokes,
    });
  }
}

- (void)erasePartialAtPoint:(NSDictionary *)point inLayout:(BsnPdfPageLayout *)layout
{
  CGFloat radius = MAX(14.0, self.eraserWidth * 1.65 + MAX(1.0, self.penWidth) * 0.5);
  BOOL changed = NO;
  CGRect changedRect = CGRectNull;
  NSMutableArray<NSDictionary *> *nextStrokes = [NSMutableArray array];

  for (NSDictionary *stroke in self.inkStrokes) {
    if (![self stroke:stroke belongsToLayout:layout]) {
      [nextStrokes addObject:stroke];
      continue;
    }
    CGFloat strokeWidth = MAX(1.0, [stroke[@"width"] doubleValue]);
    CGRect strokeBounds = [self logicalBoundsForStroke:stroke padding:radius + strokeWidth];
    CGRect eraserBounds = CGRectInset(CGRectMake([point[@"x"] doubleValue], [point[@"y"] doubleValue], 1.0, 1.0), -radius, -radius);
    if (!CGRectIsNull(strokeBounds) && !CGRectIntersectsRect(strokeBounds, eraserBounds)) {
      [nextStrokes addObject:stroke];
      continue;
    }
    NSString *style = [RCTConvert NSString:stroke[@"style"]] ?: @"pen";
    if ([style isEqualToString:@"shape"]) {
      if ([self stroke:stroke hitsPoint:point radius:radius]) {
        changed = YES;
        changedRect = CGRectUnion(changedRect, [self dirtyRectForStroke:stroke]);
      } else {
        [nextStrokes addObject:stroke];
      }
      continue;
    }
    NSArray<NSDictionary *> *split = [self splitStroke:stroke byEraserAtPoint:point radius:radius];
    if (split == nil) {
      [nextStrokes addObject:stroke];
      continue;
    }
    changed = YES;
    changedRect = CGRectUnion(changedRect, [self dirtyRectForStroke:stroke]);
    for (NSDictionary *nextStroke in split) {
      changedRect = CGRectUnion(changedRect, [self dirtyRectForStroke:nextStroke]);
    }
    [nextStrokes addObjectsFromArray:split];
  }

  if (!changed) return;
  _inkStrokes = [nextStrokes copy];
  [self resetStrokeBoundsCache];
  if (CGRectIsNull(changedRect)) {
    [self redrawContent];
  } else {
    [self setEditOverlayNeedsDisplayInRectSafely:changedRect];
  }
}

- (BOOL)removeInkStrokeLocallyWithId:(NSString *)strokeId
{
  if (strokeId.length == 0 || self.inkStrokes.count == 0) return NO;
  NSMutableArray<NSDictionary *> *nextStrokes = [NSMutableArray arrayWithCapacity:self.inkStrokes.count];
  BOOL removed = NO;
  CGRect dirtyRect = CGRectNull;
  for (NSDictionary *stroke in self.inkStrokes) {
    NSString *currentId = [RCTConvert NSString:stroke[@"id"]];
    if (!removed && [currentId isEqualToString:strokeId]) {
      removed = YES;
      dirtyRect = [self dirtyRectForStroke:stroke];
      continue;
    }
    [nextStrokes addObject:stroke];
  }
  if (!removed) return NO;
  [self.pendingRemovedStrokeIds addObject:strokeId];
  _inkStrokes = [nextStrokes copy];
  [self resetStrokeBoundsCache];
  if (CGRectIsNull(dirtyRect) || CGRectIsEmpty(dirtyRect)) {
    [self redrawContent];
  } else {
    [self setEditOverlayNeedsDisplayInRectSafely:dirtyRect];
  }
  return YES;
}

- (NSArray<NSDictionary *> *)splitStroke:(NSDictionary *)stroke byEraserAtPoint:(NSDictionary *)point radius:(CGFloat)radius
{
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return nil;
  CGFloat hitRadius = radius + MAX(1.0, [stroke[@"width"] doubleValue]) * 0.45;

  BOOL changed = NO;
  NSMutableArray<NSArray *> *chunks = [NSMutableArray array];
  NSMutableArray<NSDictionary *> *currentChunk = [NSMutableArray array];

  for (NSInteger index = 0; index < points.count; index += 1) {
    NSDictionary *strokePoint = points[index];
    if (index == 0) {
      if ([self distanceFromPoint:strokePoint toPoint:point] > hitRadius) {
        [currentChunk addObject:strokePoint];
      } else {
        changed = YES;
      }
      continue;
    }

    NSDictionary *previous = points[index - 1];
    CGFloat segmentLength = [self distanceFromPoint:previous toPoint:strokePoint];
    NSInteger sampleCount = MAX(1, (NSInteger)ceil(segmentLength / MAX(2.5, radius / 2.0)));
    for (NSInteger sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      NSDictionary *sample = sampleIndex == sampleCount
        ? strokePoint
        : [self interpolatePointFrom:previous to:strokePoint ratio:(CGFloat)sampleIndex / (CGFloat)sampleCount];
      if ([self distanceFromPoint:sample toPoint:point] <= hitRadius) {
        changed = YES;
        if ([self shouldKeepChunk:currentChunk forStroke:stroke]) [chunks addObject:[currentChunk copy]];
        currentChunk = [NSMutableArray array];
      } else {
        [self appendPoint:sample toChunk:currentChunk];
      }
    }
  }
  if ([self shouldKeepChunk:currentChunk forStroke:stroke]) [chunks addObject:[currentChunk copy]];
  if (!changed) return nil;

  NSTimeInterval timestamp = NSDate.date.timeIntervalSince1970 * 1000.0;
  NSMutableArray<NSDictionary *> *result = [NSMutableArray array];
  [chunks enumerateObjectsUsingBlock:^(NSArray *chunk, NSUInteger index, BOOL *stop) {
    NSMutableDictionary *nextStroke = [stroke mutableCopy];
    nextStroke[@"id"] = [NSString stringWithFormat:@"%@-erase-%lld-%lu", [RCTConvert NSString:stroke[@"id"]] ?: @"stroke", (long long)timestamp, (unsigned long)index];
    nextStroke[@"points"] = chunk;
    [result addObject:nextStroke];
  }];
  return result;
}

- (BOOL)stroke:(NSDictionary *)stroke hitsPoint:(NSDictionary *)point radius:(CGFloat)radius
{
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return NO;
  CGFloat strokeWidth = MAX(1.0, [stroke[@"width"] doubleValue]);
  CGRect strokeBounds = [self logicalBoundsForStroke:stroke padding:radius + strokeWidth];
  CGRect hitBounds = CGRectInset(CGRectMake([point[@"x"] doubleValue], [point[@"y"] doubleValue], 1.0, 1.0), -radius, -radius);
  if (!CGRectIsNull(strokeBounds) && !CGRectIntersectsRect(strokeBounds, hitBounds)) return NO;
  for (NSInteger index = 0; index < points.count; index += 1) {
    NSDictionary *candidate = points[index];
    if ([self distanceFromPoint:candidate toPoint:point] <= radius) return YES;
    if (index > 0 && [self distanceFromPoint:point toSegmentStart:points[index - 1] end:candidate] <= radius) return YES;
  }
  return NO;
}

- (CGFloat)distanceFromPoint:(NSDictionary *)left toPoint:(NSDictionary *)right
{
  CGFloat dx = [left[@"x"] doubleValue] - [right[@"x"] doubleValue];
  CGFloat dy = [left[@"y"] doubleValue] - [right[@"y"] doubleValue];
  return hypot(dx, dy);
}

- (CGFloat)distanceFromPoint:(NSDictionary *)point toSegmentStart:(NSDictionary *)start end:(NSDictionary *)end
{
  CGFloat dx = [end[@"x"] doubleValue] - [start[@"x"] doubleValue];
  CGFloat dy = [end[@"y"] doubleValue] - [start[@"y"] doubleValue];
  CGFloat lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) return [self distanceFromPoint:point toPoint:start];
  CGFloat t = ((([point[@"x"] doubleValue] - [start[@"x"] doubleValue]) * dx) + (([point[@"y"] doubleValue] - [start[@"y"] doubleValue]) * dy)) / lengthSquared;
  t = MIN(1.0, MAX(0.0, t));
  NSDictionary *projection = @{
    @"x": @([start[@"x"] doubleValue] + t * dx),
    @"y": @([start[@"y"] doubleValue] + t * dy),
  };
  return [self distanceFromPoint:point toPoint:projection];
}

- (NSDictionary *)interpolatePointFrom:(NSDictionary *)start to:(NSDictionary *)end ratio:(CGFloat)ratio
{
  NSMutableDictionary *point = [end mutableCopy];
  point[@"x"] = @([start[@"x"] doubleValue] + ([end[@"x"] doubleValue] - [start[@"x"] doubleValue]) * ratio);
  point[@"y"] = @([start[@"y"] doubleValue] + ([end[@"y"] doubleValue] - [start[@"y"] doubleValue]) * ratio);
  return point;
}

- (void)appendPoint:(NSDictionary *)point toChunk:(NSMutableArray<NSDictionary *> *)chunk
{
  NSDictionary *previous = chunk.lastObject;
  if (previous != nil && [self distanceFromPoint:previous toPoint:point] < 0.65) return;
  [chunk addObject:point];
}

- (BOOL)shouldKeepChunk:(NSArray<NSDictionary *> *)points forStroke:(NSDictionary *)stroke
{
  if (points.count <= 1) return NO;
  CGFloat length = 0;
  for (NSInteger index = 1; index < points.count; index += 1) {
    length += [self distanceFromPoint:points[index - 1] toPoint:points[index]];
  }
  return length >= MAX(3.0, [stroke[@"width"] doubleValue] * 0.45);
}

- (CGRect)dirtyRectForStroke:(NSDictionary *)stroke
{
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return CGRectNull;

  BsnPdfPageLayout *targetLayout = nil;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if ([self stroke:stroke belongsToLayout:layout]) {
      targetLayout = layout;
      break;
    }
  }
  if (targetLayout == nil) return CGRectNull;

  CGFloat minX = CGFLOAT_MAX;
  CGFloat minY = CGFLOAT_MAX;
  CGFloat maxX = -CGFLOAT_MAX;
  CGFloat maxY = -CGFLOAT_MAX;
  for (NSDictionary *point in points) {
    CGPoint screenPoint = [self screenPointForInkPoint:point layout:targetLayout];
    minX = MIN(minX, screenPoint.x);
    minY = MIN(minY, screenPoint.y);
    maxX = MAX(maxX, screenPoint.x);
    maxY = MAX(maxY, screenPoint.y);
  }

  if (minX == CGFLOAT_MAX || minY == CGFLOAT_MAX || maxX == -CGFLOAT_MAX || maxY == -CGFLOAT_MAX) return CGRectNull;
  CGFloat strokeWidth = MAX(1.0, [stroke[@"width"] doubleValue]);
  CGFloat padding = MAX(24.0, strokeWidth * 5.0 + 18.0);
  CGRect strokeRect = CGRectInset(CGRectMake(minX, minY, MAX(1.0, maxX - minX), MAX(1.0, maxY - minY)), -padding, -padding);
  return CGRectIntersection(CGRectInset(targetLayout.frame, -padding, -padding), strokeRect);
}

- (CGRect)dirtyRectForLiveStroke:(NSDictionary *)stroke
{
  NSArray *points = stroke[@"points"];
  if (![points isKindOfClass:NSArray.class] || points.count == 0) return CGRectNull;

  NSString *style = [RCTConvert NSString:stroke[@"style"]] ?: @"pen";
  if ([style isEqualToString:@"shape"] || points.count <= 2) {
    return [self dirtyRectForStroke:stroke];
  }

  BsnPdfPageLayout *targetLayout = nil;
  for (BsnPdfPageLayout *layout in self.layouts) {
    if ([self stroke:stroke belongsToLayout:layout]) {
      targetLayout = layout;
      break;
    }
  }
  if (targetLayout == nil) return CGRectNull;

  NSInteger startIndex = MAX(0, (NSInteger)points.count - 7);
  CGFloat minX = CGFLOAT_MAX;
  CGFloat minY = CGFLOAT_MAX;
  CGFloat maxX = -CGFLOAT_MAX;
  CGFloat maxY = -CGFLOAT_MAX;
  for (NSInteger index = startIndex; index < points.count; index += 1) {
    CGPoint screenPoint = [self screenPointForInkPoint:points[index] layout:targetLayout];
    minX = MIN(minX, screenPoint.x);
    minY = MIN(minY, screenPoint.y);
    maxX = MAX(maxX, screenPoint.x);
    maxY = MAX(maxY, screenPoint.y);
  }

  if (minX == CGFLOAT_MAX || minY == CGFLOAT_MAX || maxX == -CGFLOAT_MAX || maxY == -CGFLOAT_MAX) return CGRectNull;
  CGFloat strokeWidth = MAX(1.0, [stroke[@"width"] doubleValue]);
  CGFloat padding = MAX(12.0, strokeWidth * 2.8 + 10.0);
  CGRect strokeRect = CGRectInset(CGRectMake(minX, minY, MAX(1.0, maxX - minX), MAX(1.0, maxY - minY)), -padding, -padding);
  return CGRectIntersection(CGRectInset(targetLayout.frame, -padding, -padding), strokeRect);
}

- (CGRect)dirtyRectForStrokeChangesFrom:(NSArray<NSDictionary *> *)beforeStrokes to:(NSArray<NSDictionary *> *)afterStrokes
{
  NSMutableDictionary<NSString *, NSDictionary *> *beforeById = [NSMutableDictionary dictionary];
  NSMutableDictionary<NSString *, NSDictionary *> *afterById = [NSMutableDictionary dictionary];
  BOOL needsFullRedraw = NO;

  for (NSDictionary *stroke in beforeStrokes ?: @[]) {
    if (![stroke isKindOfClass:NSDictionary.class]) {
      needsFullRedraw = YES;
      break;
    }
    NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
    if (strokeId.length == 0 || beforeById[strokeId] != nil) {
      needsFullRedraw = YES;
      break;
    }
    beforeById[strokeId] = stroke;
  }

  if (!needsFullRedraw) {
    for (NSDictionary *stroke in afterStrokes ?: @[]) {
      if (![stroke isKindOfClass:NSDictionary.class]) {
        needsFullRedraw = YES;
        break;
      }
      NSString *strokeId = [RCTConvert NSString:stroke[@"id"]];
      if (strokeId.length == 0 || afterById[strokeId] != nil) {
        needsFullRedraw = YES;
        break;
      }
      afterById[strokeId] = stroke;
    }
  }

  if (needsFullRedraw) {
    CGRect fullRect = self.contentView.bounds;
    return CGRectIsEmpty(fullRect) ? CGRectNull : fullRect;
  }

  __block CGRect dirtyRect = CGRectNull;
  void (^includeStroke)(NSDictionary *) = ^(NSDictionary *stroke) {
    CGRect strokeRect = [self dirtyRectForStroke:stroke];
    if (CGRectIsNull(strokeRect) || CGRectIsEmpty(strokeRect)) {
      CGRect fullRect = self.contentView.bounds;
      if (!CGRectIsEmpty(fullRect)) dirtyRect = BsnPdfUnionDirtyRects(dirtyRect, fullRect);
      return;
    }
    dirtyRect = BsnPdfUnionDirtyRects(dirtyRect, strokeRect);
  };

  [beforeById enumerateKeysAndObjectsUsingBlock:^(NSString *strokeId, NSDictionary *beforeStroke, BOOL *stop) {
    NSDictionary *afterStroke = afterById[strokeId];
    if (afterStroke == nil) {
      includeStroke(beforeStroke);
    } else if (![beforeStroke isEqualToDictionary:afterStroke]) {
      includeStroke(beforeStroke);
      includeStroke(afterStroke);
    }
  }];

  [afterById enumerateKeysAndObjectsUsingBlock:^(NSString *strokeId, NSDictionary *afterStroke, BOOL *stop) {
    if (beforeById[strokeId] == nil) includeStroke(afterStroke);
  }];

  return dirtyRect;
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
  NSDictionary *liveStroke = self.activePredictedStroke ?: self.activeStroke;
  if (liveStroke != nil) {
    CGRect dirtyRect = [self dirtyRectForLiveStroke:liveStroke];
    if (!CGRectIsNull(dirtyRect)) {
      CGRect redrawRect = CGRectIsNull(self.lastActiveStrokeDirtyRect)
        ? dirtyRect
        : CGRectUnion(self.lastActiveStrokeDirtyRect, dirtyRect);
      self.lastActiveStrokeDirtyRect = dirtyRect;
      [self setLiveInkNeedsDisplayInContentRect:redrawRect];
      return;
    }
  }
  [self setEditOverlayNeedsDisplaySafely];
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
RCT_EXPORT_VIEW_PROPERTY(requestedPageSerial, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(notebookPages, NSArray)
RCT_EXPORT_VIEW_PROPERTY(inkTool, NSString)
RCT_EXPORT_VIEW_PROPERTY(fingerDrawingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(penColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(penWidth, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(brushType, NSString)
RCT_EXPORT_VIEW_PROPERTY(linePattern, NSString)
RCT_EXPORT_VIEW_PROPERTY(eraserMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(eraserWidth, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(brushSettings, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(inkStrokes, NSArray)
RCT_EXPORT_VIEW_PROPERTY(textAnnotations, NSArray)
RCT_EXPORT_VIEW_PROPERTY(imageAnnotations, NSArray)
RCT_EXPORT_VIEW_PROPERTY(pageCaptureReferences, NSArray)
RCT_EXPORT_VIEW_PROPERTY(openPageCaptureReferenceId, NSString)
RCT_EXPORT_VIEW_PROPERTY(hiddenTextAnnotationIds, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectionPreviewStrokeIds, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectionPreviewPageNumber, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(selectionPreviewGeneratedPageId, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectionPreviewOffsetX, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionPreviewOffsetY, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayPageNumber, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayGeneratedPageId, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayX, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayY, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayWidth, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayHeight, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayPageWidth, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayPageHeight, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayDraft, BOOL)
RCT_EXPORT_VIEW_PROPERTY(selectionGestureEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(selectionMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectionOverlayPath, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectionMenuEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(selectionMenuEditable, BOOL)
RCT_EXPORT_VIEW_PROPERTY(textGestureEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(customViewportCoreEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(perfLoggingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(renderDebugLoggingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onDocumentLoaded, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPageChanged, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onViewportChanged, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCommitInkStroke, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onRemoveInkStroke, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onReplaceInkStrokes, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSelectionGesture, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSelectionAction, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onTextAnnotationAdd, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onTextAnnotationChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onTextAnnotationRemove, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPageCaptureReferenceAction, RCTDirectEventBlock)

@end
