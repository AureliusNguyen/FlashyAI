/** Simple classname merge utility — no clsx/tailwind-merge dependency needed */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ")
}
