import { cn } from "../lib/utils";

type BrandLogoVariant = "horizontal" | "vertical" | "responsive";

export function BrandLogo({
  variant = "responsive",
  className,
  imageClassName,
}: {
  variant?: BrandLogoVariant;
  className?: string;
  imageClassName?: string;
}) {
  const showVertical = variant === "vertical";
  const showHorizontal = variant === "horizontal";

  return (
    <span className={cn("inline-flex items-center leading-none", className)}>
      <img
        src="/brand/autoyt-vertical.png"
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
        src="/brand/autoyt-horizontal.png"
        alt="AutoYT"
        className={cn(
          "h-auto object-contain",
          showVertical ? "hidden" : "hidden md:block",
          showHorizontal && "block",
          imageClassName,
        )}
        draggable={false}
      />
    </span>
  );
}
