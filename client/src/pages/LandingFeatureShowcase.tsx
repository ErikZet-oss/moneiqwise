import { useEffect, useRef } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

export type LandingFeature = {
  Icon: LucideIcon;
  title: string;
  description: string;
  img: string;
};

const PHONE_SLIDE_X = 120;
const PHONE_ROTATE_DEG = 4;
const TEXT_SLIDE_Y = 24;
const GLOW_FACTOR = 0.3;

export function LandingScrollCue({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto flex flex-col items-center gap-1.5 py-4 text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-white/45 transition-colors hover:text-primary"
    >
      Čo v aplikácii nájdeš
      <ChevronDown className="h-5 w-5 motion-safe:animate-bounce" aria-hidden />
    </button>
  );
}

/** Desktop feature sections: phone slides in from the side as the section scrolls into view. */
export function LandingFeatureShowcase({ features }: { features: LandingFeature[] }) {
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const update = () => {
      raf = 0;
      const reduce = reduceQuery.matches;
      const vh = window.innerHeight || 1;
      for (const section of sectionRefs.current) {
        if (!section) continue;
        const dir = Number(section.dataset.dir || 1);
        const rect = section.getBoundingClientRect();
        const start = vh;
        const end = vh * 0.5 - rect.height / 2;
        const p = Math.min(1, Math.max(0, (start - rect.top) / (start - end || 1)));
        const textP = Math.min(1, p * 2);
        const phone = section.querySelector<HTMLElement>("[data-showcase-phone]");
        const text = section.querySelector<HTMLElement>("[data-showcase-text]");
        const glow = section.querySelector<HTMLElement>("[data-showcase-glow]");
        if (phone) {
          phone.style.opacity = String(0.35 + 0.65 * p);
          phone.style.transform = reduce
            ? "none"
            : `translate3d(${((1 - p) * PHONE_SLIDE_X * dir).toFixed(1)}px, 0, 0) rotate(${((1 - p) * PHONE_ROTATE_DEG * dir).toFixed(2)}deg)`;
        }
        if (text) {
          text.style.opacity = String(textP);
          text.style.transform = reduce ? "none" : `translate3d(0, ${((1 - textP) * TEXT_SLIDE_Y).toFixed(1)}px, 0)`;
        }
        if (glow && !reduce) {
          const traveled = Math.max(0, Math.min(vh + rect.height, vh - rect.top));
          glow.style.transform = `translate3d(0, ${(traveled * GLOW_FACTOR - rect.height * 0.3).toFixed(1)}px, 0)`;
        }
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    reduceQuery.addEventListener("change", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduceQuery.removeEventListener("change", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div id="landing-features" className="relative">
      {features.map(({ Icon, title, description, img }, i) => {
        const phoneLeft = i % 2 === 1;
        const dir = phoneLeft ? -1 : 1;
        return (
          <section
            key={title}
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            data-dir={dir}
            className="relative overflow-hidden"
          >
            <div
              data-showcase-glow
              aria-hidden
              className={`pointer-events-none absolute top-1/2 h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(166_70%_45%_/_0.16),transparent_65%)] will-change-transform ${
                phoneLeft ? "left-[8%]" : "right-[8%]"
              }`}
            />
            <div
              className={`relative mx-auto flex min-h-[700px] w-full max-w-[1200px] items-center gap-16 px-10 ${
                phoneLeft ? "flex-row-reverse" : ""
              }`}
            >
              <div data-showcase-text className="min-w-0 flex-1 will-change-transform">
                <div className="font-mono text-[13px] font-medium text-primary">
                  {String(i + 1).padStart(2, "0")} / {String(features.length).padStart(2, "0")}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-white">{title}</h3>
                </div>
                <p className="mt-4 text-[17px] font-medium leading-snug text-white/60">{description}</p>
              </div>
              <div
                data-showcase-phone
                className="relative h-[581px] w-[281px] shrink-0 overflow-hidden rounded-[44px] border-2 border-white/15 bg-[#08090b] p-3 shadow-[0_0_60px_rgba(47,218,184,0.16)] will-change-transform"
              >
                <img
                  src={img}
                  alt={title}
                  className="h-full w-full rounded-[32px] object-cover object-top"
                  loading="lazy"
                  decoding="async"
                  width={390}
                  height={844}
                />
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
