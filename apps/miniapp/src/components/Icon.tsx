import { ICONS, type IconName } from '../icons/icons.ts';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Подпись для диктора; без неё иконка декоративная (aria-hidden). */
  label?: string;
}

/** Иконка Lucide из пакета дизайна: обводка 1,75 px, цвет — currentColor. */
export function Icon({ name, size = 20, className, label }: IconProps) {
  const brand = name === 'brand-mark';
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={brand ? '0 0 48 48' : '0 0 24 24'}
      fill={brand ? 'currentColor' : 'none'}
      stroke={brand ? 'none' : 'currentColor'}
      strokeWidth={brand ? undefined : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      // Статичная разметка из пакета дизайна, без пользовательских данных.
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
