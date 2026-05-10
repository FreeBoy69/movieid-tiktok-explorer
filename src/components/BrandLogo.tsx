import { cn } from "../lib/utils";

type BrandLogoVariant = "horizontal" | "vertical" | "stacked" | "responsive";
type BrandLogoTheme = "light" | "dark";

const logoSources: Record<BrandLogoTheme, { horizontal: string; stacked: string }> = {
  light: {
    horizontal: "/brand/autoyt-light-horizontal.png",
    stacked: "/brand/autoyt-light-stacked.png",
  },
  dark: {
    horizontal: "/brand/autoyt-dark-horizontal.png",
    stacked: "/brand/autoyt-dark-stacked.png",
  },
};

export function BrandLogo({
  variant = "responsive",
  theme = "light",
  className,
  imageClassName,
}: {
  variant?: BrandLogoVariant;
  theme?: BrandLogoTheme;
  className?: string;
  imageClassName?: string;
}) {
  const showStacked = variant === "vertical" || variant === "stacked";
  const showHorizontal = variant === "horizontal";
  const sources = logoSources[theme];

  return (
    <span className={cn("inline-flex items-center leading-none", className)}>
      <img
        src={sources.stacked}
        alt="AutoYT"
        className={cn(
          "h-auto object-contain",
          showHorizontal ? "hidden" : "block",
          variant === "responsive" && "md:hidden",
          imageClassName,
        )}
        draggable={false}
      />
      <img
        src={sources.horizontal}
        alt="AutoYT"
        className={cn(
          "h-auto object-contain",
          showStacked ? "hidden" : "hidden md:block",
          showHorizontal && "block",
          imageClassName,
        )}
        draggable={false}
      />
    </span>
  );
}
