import { useEffect, useRef } from "react";
import "./feature-parallax.css";

const FEATURES = [
  {
    title: "Prehľad portfólia",
    desc: "Celková hodnota, zisk/strata a denná zmena",
    img: "/login/feature-1-prehlad.png",
  },
  {
    title: "Analýza ziskov",
    desc: "Realizované zisky, YTD a mesačné prehľady",
    img: "/login/feature-2-zisk.png",
  },
  {
    title: "Sledovanie dividend",
    desc: "Hrubé, čisté dividendy a zrážková daň",
    img: "/login/feature-3-dividendy.png",
  },
  {
    title: "Import/Export",
    desc: "CSV import a export všetkých transakcií",
    img: "/login/feature-4-historia.png",
  },
  {
    title: "Pokročilé grafy výkonu",
    desc: "Porovnanie portfólia vs. S&P 500 a vývoj v čase",
    img: "/login/feature-5-grafy.png",
  },
  {
    title: "Trhový kalendár udalostí",
    desc: "Earnings, dividendy a makro dáta s preklikom na detaily",
    img: "/login/feature-6-kalendar.png",
  },
  {
    title: "Opcie a daňový asistent",
    desc: "Sledovanie opcií, realizovaného zisku a ročných prehľadov",
    img: "/login/feature-7-dane.png",
  },
] as const;

const PHONE_SLIDE_X = 160;
const PHONE_SLIDE_Y = 40;
const TEXT_SLIDE_Y = 24;

function supportsViewTimeline(): boolean {
  try {
    return (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("animation-timeline", "view()")
    );
  } catch {
    return false;
  }
}

/**
 * Login feature parallax — CSS phone frame + Figma @2x screen exports.
 * Primary path: CSS scroll-driven view() timelines (Chrome/Android, Safari 18+).
 * Fallback: JS progress from getBoundingClientRect on window + visualViewport.
 */
export function FeatureParallax() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (supportsViewTimeline()) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let ticking = false;

    const apply = (section: HTMLElement, p: number, dir: number) => {
      const phone = section.querySelector<HTMLElement>("[data-parallax-phone]");
      const text = section.querySelector<HTMLElement>("[data-parallax-text]");
      const glow = section.querySelector<HTMLElement>("[data-parallax-glow]");
      if (phone) {
        const x = (1 - p) * PHONE_SLIDE_X * dir;
        const y = (1 - p) * PHONE_SLIDE_Y;
        phone.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        phone.style.opacity = String(0.4 + 0.6 * p);
      }
      if (text) {
        const textP = Math.min(1, p * 2);
        const y = (1 - textP) * TEXT_SLIDE_Y;
        text.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
        text.style.opacity = String(textP);
      }
      if (glow) {
        const rect = section.getBoundingClientRect();
        const vh = window.visualViewport?.height ?? window.innerHeight;
        const traveled = Math.max(0, Math.min(vh + rect.height, vh - rect.top));
        glow.style.transform = `translate3d(0, ${(traveled * 0.3).toFixed(1)}px, 0)`;
      }
    };

    const update = () => {
      raf = 0;
      ticking = false;
      const reduce = reduceQuery.matches;
      const vh = window.visualViewport?.height ?? window.innerHeight ?? 1;
      for (const el of sectionRefs.current) {
        if (!el) continue;
        const dir = Number(el.dataset.dir || 1);
        if (reduce) {
          apply(el, 1, dir);
          continue;
        }
        const top = el.getBoundingClientRect().top;
        // 0 = section top at viewport bottom; 1 = section vertically centered
        const start = vh;
        const end = vh * 0.5 - el.offsetHeight / 2;
        const p = Math.min(1, Math.max(0, (start - top) / (start - end || 1)));
        apply(el, p, dir);
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.visualViewport?.addEventListener("resize", onScroll);
    window.visualViewport?.addEventListener("scroll", onScroll);
    reduceQuery.addEventListener("change", onScroll);

    // Keep sampling during momentum scroll on some mobile browsers
    let interval = 0;
    const armPulse = () => {
      window.clearInterval(interval);
      let n = 0;
      interval = window.setInterval(() => {
        update();
        if (++n > 40) window.clearInterval(interval);
      }, 32);
    };
    window.addEventListener("touchmove", armPulse, { passive: true });
    window.addEventListener("scroll", armPulse, { passive: true });

    const kick = window.setTimeout(update, 50);

    return () => {
      window.clearTimeout(kick);
      window.clearInterval(interval);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.visualViewport?.removeEventListener("resize", onScroll);
      window.visualViewport?.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchmove", armPulse);
      window.removeEventListener("scroll", armPulse);
      reduceQuery.removeEventListener("change", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={rootRef} className="rd-feature-parallax overflow-x-hidden" id="rd-login-features">
      {FEATURES.map((feature, i) => {
        const fromLeft = i % 2 === 1;
        const dir = fromLeft ? -1 : 1;
        return (
          <section
            key={feature.title}
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            data-dir={dir}
            data-parallax-section
            className="relative h-[560px] overflow-hidden"
          >
            <div
              data-parallax-glow
              aria-hidden
              className={`pointer-events-none absolute top-[140px] size-[280px] rounded-full bg-[var(--rd-profit)]/30 blur-3xl will-change-transform ${
                fromLeft ? "left-[-120px]" : "right-[-120px]"
              }`}
            />
            <div
              data-parallax-text
              className={`rd-parallax-text absolute top-[190px] w-[196px] will-change-transform ${
                fromLeft ? "right-4" : "left-6"
              } ${fromLeft ? "rd-parallax-from-left" : "rd-parallax-from-right"}`}
            >
              <div className="font-mono text-[11px] leading-[14px] text-[var(--rd-profit)]">
                {String(i + 1).padStart(2, "0")} / 07
              </div>
              <h3 className="mt-2 text-[18px] font-bold leading-[22px] tracking-[-0.18px] text-[var(--rd-text-primary)]">
                {feature.title}
              </h3>
              <p className="mt-2 text-[13px] leading-[18px] text-[var(--rd-text-secondary)]">{feature.desc}</p>
            </div>

            <div
              data-parallax-phone
              className={`rd-parallax-phone absolute top-[60px] h-[440px] w-[211px] overflow-hidden rounded-[34px] border-2 border-[var(--rd-border-strong)] bg-[var(--rd-bg-base)] shadow-[0_0_40px_rgba(47,218,184,0.18)] will-change-transform ${
                fromLeft ? "left-[-70px] rd-parallax-from-left" : "right-[-70px] rd-parallax-from-right"
              }`}
            >
              <img
                src={feature.img}
                alt={feature.title}
                className="mt-[14px] w-full px-2"
                loading="lazy"
                decoding="async"
                width={390}
                height={844}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
