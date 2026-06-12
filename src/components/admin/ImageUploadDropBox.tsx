import {
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import {
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SUB_PANEL_CLASS,
} from './LpEditorPrimitives';

interface Props {
  accept: string;
  busy?: boolean;
  buttonLabel: string;
  compact?: boolean;
  description: ReactNode;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  progress?: string;
  title: ReactNode;
}

export default function ImageUploadDropBox({
  accept,
  busy = false,
  buttonLabel,
  compact = false,
  description,
  multiple = false,
  onFiles,
  progress = '',
  title,
}: Props) {
  const [dragOver, setDragOver] = useState(false);

  function onDragOver(e: DragEvent) {
    if (busy) return;
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const files = e.dataTransfer?.files
      ? Array.from(e.dataTransfer.files)
      : [];
    onFiles(files);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    onFiles(files);
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`${EDITOR_SUB_PANEL_CLASS} w-full border border-dashed text-center backdrop-blur-xl transition ${
        compact ? 'px-4 py-5 sm:px-5' : 'px-5 py-6 sm:px-6 sm:py-7'
      } ${
        busy
          ? 'border-[#9bb4d6] bg-[#eef4fb]/88'
          : dragOver
            ? 'border-[#567baf] bg-[#eef4fb]/92 shadow-[0_16px_34px_rgba(86,123,175,0.12)]'
            : 'border-[#c8d5e8]/90 bg-[#f6f8fb]/75 hover:border-[#9bb4d6] hover:bg-white/75'
      }`}
    >
      {busy ? (
        <p className="text-sm font-extrabold text-[#567baf]">
          {progress || 'アップロード中...'}
        </p>
      ) : (
        <div className="text-sm text-[#596173]">
          <span
            className={`mx-auto mb-3 flex items-center justify-center rounded-full bg-[#eef4fb] text-[#567baf] ${
              compact ? 'h-10 w-10' : 'h-11 w-11'
            }`}
          >
            <Upload size={compact ? 18 : 20} strokeWidth={2.3} aria-hidden="true" />
          </span>
          <p className="font-extrabold text-[#3f4352]">{title}</p>
          <p className="mt-1 text-xs font-semibold leading-[1.45] text-[#8b91a1]">
            {description}
          </p>
          <label className={`${EDITOR_PRIMARY_BUTTON_CLASS} mt-4 min-h-14 cursor-pointer gap-2 px-5 text-base sm:min-h-11 sm:px-4 sm:text-sm`}>
            <ImagePlus size={16} strokeWidth={2.3} aria-hidden="true" />
            <span>{buttonLabel}</span>
            <input
              type="file"
              accept={accept}
              multiple={multiple}
              className="sr-only"
              onChange={onFileChange}
            />
          </label>
        </div>
      )}
    </div>
  );
}
