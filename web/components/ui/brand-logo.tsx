export function BrandLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dimensions = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-16 w-16" : "h-10 w-10";
  return (
    <img
      src="/logo.png"
      alt="CCA Campaign Manager"
      className={`${dimensions} rounded-xl shadow-lg shadow-purple-500/20`}
    />
  );
}
