import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-foreground hover:opacity-90",
        secondary: "bg-surface border border-border-strong hover:bg-surface-2",
        ghost: "hover:bg-surface-2 text-foreground",
        danger: "bg-danger text-white hover:opacity-90",
        success: "bg-success text-white hover:opacity-90",
      },
      size: { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3", lg: "h-10 px-4" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
