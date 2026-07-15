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

  if (theme === "dark") {
    const mark = (
      <img src="/favicon.svg" alt="" className="aspect-square h-full w-auto shrink-0 object-contain" draggable={false} />
    );
    const wordmark = <span className="whitespace-nowrap text-xl font-black leading-none text-white">autoYT</span>;
    return (
      <span className={cn("inline-flex items-center leading-none", className)} aria-label="AutoYT">
        <span className={cn("h-full w-full items-center justify-center gap-1.5", showHorizontal ? "flex" : "hidden", variant === "responsive" && "md:flex")}>
          {mark}{wordmark}
        </span>
        <span className={cn("h-full w-full flex-col items-center justify-center gap-0.5", showHorizontal ? "hidden" : "flex", variant === "responsive" && "md:hidden")}>
          <img src="/favicon.svg" alt="" className={cn("min-h-0 flex-1 object-contain", imageClassName)} draggable={false} />
          <span className="whitespace-nowrap text-[10px] font-black leading-none text-white">autoYT</span>
        </span>
      </span>
    );
  }

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
