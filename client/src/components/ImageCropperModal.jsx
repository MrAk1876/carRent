import React, { useState } from "react";
import Cropper from "react-easy-crop";
import { getCroppedImg } from "../utils/cropImage";

const ImageCropperModal = ({
  imageSrc,
  aspect = 1,
  onCancel,
  onSave,
  outputSize = 500,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState(null);

  const onCropComplete = (_, pixels) => {
    setCroppedPixels(pixels);
  };

  const saveImage = async () => {
    if (!croppedPixels) return;
    const blob = await getCroppedImg(imageSrc, croppedPixels, outputSize);
    onSave(blob);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white p-4 rounded-lg w-[min(92vw,360px)]">
        <div className="relative w-full h-55 sm:h-65">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          className="w-full mt-3"
        />

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 rounded border border-borderColor">
            Cancel
          </button>
          <button
            onClick={saveImage}
            className="bg-primary text-white px-4 py-1.5 rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropperModal;
