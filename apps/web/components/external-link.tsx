import { linkLabel } from '@civicscope/core';

/**
 * A link to an outside page that never stretches the layout: a title that is really a
 * URL, or no title at all, is shown as a short form of the address. The full address
 * stays in the link and appears on hover.
 */
export function ExternalLink({
  href,
  label,
  max,
  rel = 'noopener noreferrer',
  className,
}: {
  href: string;
  label?: string | null;
  max?: number;
  rel?: string;
  className?: string;
}) {
  const text = linkLabel(href, label, max);
  return (
    <a
      href={href}
      rel={rel}
      target="_blank"
      className={className ? `ext-link ${className}` : 'ext-link'}
      title={text === label ? undefined : href}
    >
      {text}
    </a>
  );
}
