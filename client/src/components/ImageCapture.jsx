import { useRef } from 'react';

/**
 * Detects whether the app is running inside a Capacitor native container
 * (Android APK) vs a regular browser.
 */
const isNativePlatform = () => {
  try {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

/**
 * Two distinct CTAs: "Take Photo" (camera capture) and "Upload Chart" (file picker).
 *
 * On native (Capacitor APK): uses @capacitor/camera which calls Android's native
 * camera intent directly. The HTML <input capture> attribute is IGNORED by the
 * WebView, so we must use the plugin.
 *
 * On web (browser): uses standard <input type="file" capture="environment">.
 */
export default function ImageCapture({ onImage, previewUrl, disabled }) {
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onImage(file);
    e.target.value = ''; // allow re-selecting the same file
  };

  /**
   * Native camera via Capacitor Camera plugin.
   * Returns a dataUrl (base64) which we convert to a File for the upload pipeline.
   */
  const takePhotoNative = async () => {
    try {
      const { Camera } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: 'DataUrl', // base64 data URL
        source: 'CAMERA', // force the camera (not gallery)
        correctOrientation: true,
        saveToGallery: false,
      });
      // Convert the dataUrl to a File so the existing compression/upload works unchanged.
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const ext = photo.format || 'jpeg';
      const file = new File([blob], `photo.${ext}`, { type: `image/${ext}` });
      onImage(file);
    } catch (err) {
      // User cancelled camera — silently ignore (not an error).
      if (!String(err).includes('cancelled') && !String(err).includes('User denied')) {
        console.warn('[camera] native capture failed, falling back to input:', err);
        cameraInputRef.current?.click();
      }
    }
  };

  const handleTakePhoto = () => {
    if (isNativePlatform()) {
      takePhotoNative();
    } else {
      cameraInputRef.current?.click();
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={handleTakePhoto}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition active:scale-[0.98] disabled:opacity-50"
        >
          <CameraIcon />
          Take Photo
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-5 text-sm font-semibold text-slate-100 ring-1 ring-slate-700 transition active:scale-[0.98] disabled:opacity-50"
        >
          <UploadIcon />
          Upload Chart
        </button>
      </div>

      {/* Hidden inputs — used on web only (native path uses Capacitor Camera) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />

      {previewUrl && (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-700">
          <img
            src={previewUrl}
            alt="Selected vibration chart preview"
            className="mx-auto max-h-72 w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9a2 2 0 012-2h2l1.5-2h7L19 7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0-12l-4 4m4-4l4 4" />
    </svg>
  );
}
