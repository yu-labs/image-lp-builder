import { Image as ImageIcon } from 'lucide-react';

const PLACEHOLDER_BACKGROUND =
  'radial-gradient(circle at 30% 18%, rgba(255, 255, 255, 0.82), transparent 38%), radial-gradient(circle at 78% 24%, rgba(86, 123, 175, 0.08), transparent 30%), linear-gradient(135deg, #f8fbff 0%, #edf3fb 100%)';

interface Props {
  className?: string;
  iconClassName?: string;
  iconSize?: number;
  label?: string;
}

export default function AdminImagePlaceholder({
  className = '',
  iconClassName = 'h-12 w-12',
  iconSize = 36,
  label = '画像未設定',
}: Props) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl text-[#567baf]/25 ${className}`}
      role="img"
      aria-label={label}
      style={{ background: PLACEHOLDER_BACKGROUND }}
    >
      <span className={`flex items-center justify-center opacity-70 ${iconClassName}`}>
        <ImageIcon size={iconSize} strokeWidth={1.4} aria-hidden={true} />
      </span>
    </div>
  );
}
