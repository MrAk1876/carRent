export const getCroppedImg = async (imageSrc, cropPixels, outputSize = 500) => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise(resolve => (image.onload = resolve));

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputSize,
    outputSize
  );

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      resolve(blob);
    }, "image/jpeg", 0.9);
  });
};
