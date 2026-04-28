from img_preprocessing.crop.yolo_world_detector import (
    YoloWorldDetector,
    clip_xyxy,
    parse_classes,
    score_detection,
)


def test_parse_classes_accepts_comma_and_space_groups() -> None:
    result = parse_classes(["whiteboard, blackboard", "projector screen"])

    assert result == ["whiteboard", "blackboard", "projector screen"]


def test_clip_xyxy_clamps_to_image_bounds() -> None:
    result = clip_xyxy([-10.0, 5.0, 200.0, 130.0], (100, 120, 3))

    assert result == [0.0, 5.0, 119.0, 99.0]


def test_score_detection_prefers_larger_relevant_surface() -> None:
    image_shape = (1000, 1000, 3)
    small = score_detection("chalkboard", 0.5, [100.0, 100.0, 250.0, 250.0], image_shape)
    large = score_detection("chalkboard", 0.5, [100.0, 100.0, 800.0, 750.0], image_shape)

    assert large > small


def test_yolo_detector_forwards_imgsz_to_predict() -> None:
    class FakeModel:
        def __init__(self) -> None:
            self.classes = None
            self.predict_kwargs = None

        def set_classes(self, classes):
            self.classes = classes

        def predict(self, **kwargs):
            self.predict_kwargs = kwargs
            return []

    fake_model = FakeModel()
    detector = object.__new__(YoloWorldDetector)
    detector.model_name = "fake"
    detector.model = fake_model

    result = detector.detect(
        "image.jpg",
        (480, 640, 3),
        classes=["whiteboard"],
        conf=0.15,
        max_det=8,
        imgsz=960,
    )

    assert result == []
    assert fake_model.classes == ["whiteboard"]
    assert fake_model.predict_kwargs["conf"] == 0.15
    assert fake_model.predict_kwargs["max_det"] == 8
    assert fake_model.predict_kwargs["imgsz"] == 960
