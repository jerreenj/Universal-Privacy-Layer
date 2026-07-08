"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { motion, useAnimation } from "framer-motion";
import { Wallet } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";

/**
 * MagnetizeButton — green particle button with a magnetic-levitation
 * effect on hover (particles fly inward, scale-up; on pointer-out
 * they spread back out). It's the visual identity the pilot asked
 * us to keep (the 'gorgeous' magnet effect).
 *
 * Slots:
 *   - prefix     ReactNode rendered before the label (a wallet logo,
 *                etc.). When it's present, the default lucide Wallet
 *                icon is hidden so each tile can show its own brand.
 *   - children   text label or any ReactNode; falls back to "Connect"
 *                when omitted (the original behaviour).
 *
 * Tunables:
 *   - particleCount   how many particles — default 12. Bump to 16+
 *                     for showcase tiles.
 *   - className       merged with the green button styling.
 *   - variant         'primary' (green) or any future override.
 */
function MagnetizeButton({
  className,
  particleCount = 12,
  attractRadius = 50,
  prefix,
  children,
  variant = "primary",
  ...props
}) {
  const [isAttracting, setIsAttracting] = useState(false);
  const [particles, setParticles] = useState([]);
  const particlesControl = useAnimation();

  useEffect(() => {
    const newParticles = Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      x: Math.random() * 200 - 100,
      y: Math.random() * 200 - 100,
    }));
    setParticles(newParticles);
  }, [particleCount]);

  const handleInteractionStart = useCallback(async () => {
    setIsAttracting(true);
    await particlesControl.start({
      x: 0,
      y: 0,
      transition: { type: "spring", stiffness: 50, damping: 10 },
    });
  }, [particlesControl]);

  const handleInteractionEnd = useCallback(async () => {
    setIsAttracting(false);
    await particlesControl.start((i) => ({
      x: particles[i]?.x || 0,
      y: particles[i]?.y || 0,
      transition: { type: "spring", stiffness: 100, damping: 15 },
    }));
  }, [particlesControl, particles]);

  const variantStyles = {
    primary: "bg-[#00FF94] hover:bg-[#00FF94]/90 text-black",
    ghost:   "bg-white/10 hover:bg-white/20 text-white",
  }[variant] || "bg-[#00FF94] hover:bg-[#00FF94]/90 text-black";

  return (
    <Button
      className={cn(
        "relative touch-none",
        "font-bold uppercase tracking-widest",
        "border-none",
        "transition-all duration-300",
        variantStyles,
        className
      )}
      onMouseEnter={handleInteractionStart}
      onMouseLeave={handleInteractionEnd}
      onTouchStart={handleInteractionStart}
      onTouchEnd={handleInteractionEnd}
      {...props}
    >
      {particles.map((_, index) => (
        <motion.div
          key={index}
          custom={index}
          initial={{ x: particles[index]?.x || 0, y: particles[index]?.y || 0 }}
          animate={particlesControl}
          className={cn(
            "absolute w-1.5 h-1.5 rounded-full",
            "bg-[#00FF94]",
            "transition-opacity duration-300",
            isAttracting ? "opacity-100" : "opacity-40"
          )}
        />
      ))}
      <span className="relative w-full flex items-center justify-center gap-2">
        {prefix !== undefined ? (
          prefix
        ) : (
          <Wallet className={cn("w-4 h-4 transition-transform duration-300", isAttracting && "scale-110")} />
        )}
        {children || (isAttracting ? "Connecting..." : "Connect")}
      </span>
    </Button>
  );
}

export { MagnetizeButton };
