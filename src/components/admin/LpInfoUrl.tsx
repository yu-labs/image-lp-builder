import { useAdminPublicOrigin } from '../../lib/admin-public-url';

interface Props {
  slug: string;
}

export default function LpInfoUrl({ slug }: Props) {
  const origin = useAdminPublicOrigin();
  const url = origin ? `${origin}/${slug}` : `/${slug}`;

  return <span className="font-mono break-all">{url}</span>;
}
