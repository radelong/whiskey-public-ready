const MAX_IMAGE_EDGE = 1200;
const MAX_IMAGE_DATA_URL_LENGTH = 700_000;

export async function compressBottlePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That image could not be opened. Try taking the photo again."));
      element.src = imageUrl;
    });

    let scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 12; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not prepare this photo.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      if (dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) return dataUrl;
      scale *= 0.75;
    }
    throw new Error("This photo is too large. Try a closer, lower-resolution photo.");
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
