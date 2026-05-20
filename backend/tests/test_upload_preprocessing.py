from pathlib import Path

import img_preprocessing.pipeline as preprocessing_pipeline
from backend.app.routes import uploads


def test_service_segmentation_cropper_does_not_save_mask() -> None:
    uploads._get_service_segmentation_cropper.cache_clear()
    cropper = uploads._get_service_segmentation_cropper()

    assert cropper.config.save_mask is False


def test_run_service_preprocessing_skips_scan_metrics(tmp_path: Path, monkeypatch) -> None:
    input_path = tmp_path / "stored-photo.jpg"
    input_path.write_bytes(b"raw image")
    output_dir = tmp_path / "preprocessed-images"
    fake_cropper = object()
    seen_kwargs = {}

    def fake_preprocess_for_service(path: Path, output_path: Path, **kwargs):
        assert path == input_path
        assert output_path == output_dir
        seen_kwargs.update(kwargs)
        return {"success": True}

    monkeypatch.setattr(uploads, "_get_service_segmentation_cropper", lambda: fake_cropper)
    monkeypatch.setattr(preprocessing_pipeline, "preprocess_for_service", fake_preprocess_for_service)

    result = uploads._run_service_preprocessing(input_path, output_dir, output_name="stored-photo")

    assert result == {"success": True}
    assert seen_kwargs["output_name"] == "stored-photo"
    assert seen_kwargs["segmentation_cropper"] is fake_cropper
    assert seen_kwargs["save_scan_metrics"] is False


def test_preprocess_upload_image_returns_service_enhanced_color(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    source_path = upload_root / "stored-photo.jpg"
    source_path.write_bytes(b"raw image")

    def fake_run_service_preprocessing(input_path: Path, output_dir: Path, *, output_name: str):
        assert input_path == source_path
        crop_path = output_dir / f"{output_name}_abc" / "crop" / f"{output_name}_crop.jpg"
        enhanced_path = output_dir / f"{output_name}_abc" / "scan_enhance" / f"{output_name}_crop_enhanced_color.jpg"
        crop_path.parent.mkdir(parents=True)
        enhanced_path.parent.mkdir(parents=True)
        crop_path.write_bytes(b"crop image")
        enhanced_path.write_bytes(b"enhanced image")
        return {
            "success": True,
            "crop_output_path": str(crop_path),
            "llm_image_path": str(enhanced_path),
            "view_path": str(enhanced_path),
            "artifacts": {"crop_path": str(crop_path), "enhanced_color_path": str(enhanced_path)},
        }

    def fail_legacy_preprocess(*args, **kwargs):
        raise AssertionError("legacy preprocessing should not run when service preprocessing succeeds")

    monkeypatch.setattr(uploads, "_run_service_preprocessing", fake_run_service_preprocessing)
    monkeypatch.setattr(uploads, "_preprocess_image", fail_legacy_preprocess)

    result = uploads._preprocess_upload_image(
        source_path,
        upload_root,
        "stored-photo.jpg",
        "image/jpeg",
    )

    assert result.processed_path is not None
    assert result.processed_path.name == "stored-photo_crop_enhanced_color.jpg"
    assert result.processed_url == "/uploads/preprocessed-images/stored-photo_abc/scan_enhance/stored-photo_crop_enhanced_color.jpg"
    assert result.thumbnail_url == "/uploads/preprocessed-images/stored-photo_abc/crop/stored-photo_crop.jpg"
    assert result.preprocessing == {
        "status": "completed",
        "fallback_used": False,
        "processed_url": "/uploads/preprocessed-images/stored-photo_abc/scan_enhance/stored-photo_crop_enhanced_color.jpg",
        "thumbnail_url": "/uploads/preprocessed-images/stored-photo_abc/crop/stored-photo_crop.jpg",
    }


def test_preprocess_upload_image_falls_back_when_service_preprocessing_fails(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    source_path = upload_root / "stored-photo.jpg"
    source_path.write_bytes(b"raw image")
    fallback_path = upload_root / "processed-images" / "stored-photo.png"
    fallback_path.parent.mkdir()
    fallback_path.write_bytes(b"fallback image")

    monkeypatch.setattr(
        uploads,
        "_run_service_preprocessing",
        lambda *args, **kwargs: {"success": False, "llm_image_path": None, "artifacts": {}},
    )
    monkeypatch.setattr(
        uploads,
        "_preprocess_image",
        lambda *args, **kwargs: (fallback_path, "/uploads/processed-images/stored-photo.png"),
    )

    result = uploads._preprocess_upload_image(
        source_path,
        upload_root,
        "stored-photo.jpg",
        "image/jpeg",
    )

    assert result.processed_path == fallback_path
    assert result.processed_url == "/uploads/processed-images/stored-photo.png"
    assert result.thumbnail_url == "/uploads/processed-images/stored-photo.png"
    assert result.preprocessing is not None
    assert result.preprocessing["status"] == "fallback"
    assert result.preprocessing["fallback_used"] is True
    assert result.preprocessing["source"] == "service_failed"
    assert result.preprocessing["fallback_url"] == "/uploads/processed-images/stored-photo.png"


def test_heic_upload_is_converted_before_service_preprocessing(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    source_path = upload_root / "stored-photo.heic"
    source_path.write_bytes(b"heic image")
    converted_path = upload_root / "preprocess-inputs" / "stored-photo.jpg"
    seen_input_paths: list[Path] = []

    def fake_convert_heic_to_jpeg(path: Path, upload_root: Path, stored_filename: str):
        converted_path.parent.mkdir()
        converted_path.write_bytes(b"converted jpeg")
        return converted_path

    def fake_run_service_preprocessing(input_path: Path, output_dir: Path, *, output_name: str):
        seen_input_paths.append(input_path)
        crop_path = output_dir / f"{output_name}_abc" / "crop" / f"{output_name}_crop.jpg"
        enhanced_path = output_dir / f"{output_name}_abc" / "scan_enhance" / f"{output_name}_crop_enhanced_color.jpg"
        crop_path.parent.mkdir(parents=True)
        enhanced_path.parent.mkdir(parents=True)
        crop_path.write_bytes(b"crop image")
        enhanced_path.write_bytes(b"enhanced image")
        return {
            "success": True,
            "crop_output_path": str(crop_path),
            "llm_image_path": str(enhanced_path),
            "view_path": str(enhanced_path),
            "artifacts": {"crop_path": str(crop_path), "enhanced_color_path": str(enhanced_path)},
        }

    monkeypatch.setattr(uploads, "_convert_heic_to_jpeg", fake_convert_heic_to_jpeg)
    monkeypatch.setattr(uploads, "_run_service_preprocessing", fake_run_service_preprocessing)

    result = uploads._preprocess_upload_image(
        source_path,
        upload_root,
        "stored-photo.heic",
        "image/heic",
    )

    assert seen_input_paths == [converted_path]
    assert result.processed_path is not None
    assert result.processed_url == "/uploads/preprocessed-images/stored-photo_abc/scan_enhance/stored-photo_crop_enhanced_color.jpg"
    assert result.thumbnail_url == "/uploads/preprocessed-images/stored-photo_abc/crop/stored-photo_crop.jpg"


def test_extensionless_jpeg_upload_is_copied_before_service_preprocessing(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    source_path = upload_root / "stored-photo-jpg"
    source_path.write_bytes(b"jpeg image")
    expected_input_path = upload_root / "preprocess-inputs" / "stored-photo-jpg.jpg"
    seen_input_paths: list[Path] = []

    def fake_run_service_preprocessing(input_path: Path, output_dir: Path, *, output_name: str):
        seen_input_paths.append(input_path)
        crop_path = output_dir / f"{output_name}_abc" / "crop" / f"{output_name}_crop.jpg"
        enhanced_path = output_dir / f"{output_name}_abc" / "scan_enhance" / f"{output_name}_crop_enhanced_color.jpg"
        crop_path.parent.mkdir(parents=True)
        enhanced_path.parent.mkdir(parents=True)
        crop_path.write_bytes(b"crop image")
        enhanced_path.write_bytes(b"enhanced image")
        return {
            "success": True,
            "crop_output_path": str(crop_path),
            "llm_image_path": str(enhanced_path),
            "view_path": str(enhanced_path),
            "artifacts": {"crop_path": str(crop_path), "enhanced_color_path": str(enhanced_path)},
        }

    monkeypatch.setattr(uploads, "_run_service_preprocessing", fake_run_service_preprocessing)

    result = uploads._preprocess_upload_image(
        source_path,
        upload_root,
        "stored-photo-jpg",
        "image/jpeg",
    )

    assert expected_input_path.read_bytes() == b"jpeg image"
    assert seen_input_paths == [expected_input_path]
    assert result.processed_path is not None
    assert result.processed_url == "/uploads/preprocessed-images/stored-photo-jpg_abc/scan_enhance/stored-photo-jpg_crop_enhanced_color.jpg"
    assert result.thumbnail_url == "/uploads/preprocessed-images/stored-photo-jpg_abc/crop/stored-photo-jpg_crop.jpg"


def test_upload_analysis_data_uri_uses_processed_image_mime_type(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    source_path.write_bytes(b"source")
    processed_path = tmp_path / "enhanced.jpg"
    processed_path.write_bytes(b"enhanced")

    image_data_uri = uploads._build_upload_analysis_image_data_uri(
        source_path=source_path,
        source_content_type="image/png",
        processed_path=processed_path,
        max_bytes=1024,
    )

    assert image_data_uri is not None
    assert image_data_uri.startswith("data:image/jpeg;base64,")


def test_format_upload_preprocessing_log_uses_readable_lines() -> None:
    message = uploads._format_upload_preprocessing_log(
        "service_failed",
        [
            ("file", "stored-photo.jpg"),
            ("stage", "crop"),
            ("message", "No target area segmentation mask was selected."),
            ("detections", "0"),
            ("empty", None),
            ("timings", uploads._format_timings(input_prepare=0.0, pipeline=113.8, total=113.9)),
        ],
    )

    assert message == (
        "[upload_preprocessing] service_failed\n"
        "  file: stored-photo.jpg\n"
        "  stage: crop\n"
        "  message: No target area segmentation mask was selected.\n"
        "  detections: 0\n"
        "  timings: input_prepare=0.0ms pipeline=113.8ms total=113.9ms"
    )


def test_preprocessing_failure_reason_summarizes_crop_failure() -> None:
    result = {
        "success": False,
        "failure_stage": "crop",
        "message": "Preprocessing did not complete successfully.",
        "crop": {
            "message": "No target area segmentation mask was selected.",
            "segmentation_error": None,
            "segmentation_detections": [],
            "original_size": {"width": 4032, "height": 3024},
        },
    }
    reason = uploads._preprocessing_failure_reason(result)
    details = uploads._preprocessing_failure_details(result)

    assert "stage=crop" in reason
    assert "No target area segmentation mask was selected." in reason
    assert "detections=0" in reason
    assert "image_size=4032x3024" in reason
    assert uploads._preprocessing_detail_code(details) == "segmentation_mask_not_found"
