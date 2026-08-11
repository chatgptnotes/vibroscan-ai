import { useRef } from 'react';

/**
 * Two distinct CTAs: "Take Photo" (camera capture) and "Upload Chart" (file picker).
 * Per spec: client compresses before submission (handled by lib/compress.js in App).
 */
export default function ImageCapture({ onImage, previewUrl, disabled }) {
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onImage(file);
    e.target.value = ''; // allow re-selecting the same file
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
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
