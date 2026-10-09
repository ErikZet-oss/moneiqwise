import { useEffect, useRef } from "react";

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

/**
 * Login feature parallax — CSS phone frame + Figma @2x screen exports.
 * Transforms are applied in JS (Safari/iOS often ignores CSS calc with custom props).
 * Listens on the login scroller + capture-phase document scroll + touchmove.
 */
export function FeatureParallax() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const apply = (section: HTMLElement, p: number, dir: number) => {
      const phone = section.querySelector<HTMLElement>("[data-parallax-phone]");
      const text = section.querySelector<HTMLElement>("[data-parallax-text]");
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
    };

    const update = () => {
      raf = 0;
      const reduce = reduceQuery.matches;
      const vh = window.innerHeight || document.documentElement.clientHeight || 1;
      for (const el of sectionRefs.current) {
        if (!el) continue;
        const dir = Number(el.dataset.dir || 1);
        if (reduce) {
          apply(el, 1, dir);
          continue;
        }
        const top = el.getBoundingClientRect().top;
        // 0 = section just entered at bottom, 1 = top near 35% of viewport
        const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.65)));
        apply(el, p, dir);
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    const scroller =
      rootRef.current?.closest<HTMLElement>("[data-redesign-login-scroll]") ??
      document.querySelector<HTMLElement>("[data-redesign-login-scroll]");

    // capture=true catches nested overflow scrollers; touchmove covers iOS rubber-band gaps
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("orientationchange", onScroll);
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    scroller?.addEventListener("touchmove", onScroll, { passive: true });
    reduceQuery.addEventListener("change", onScroll);

    // first paint after layout
    update();
    const kick = window.setTimeout(update, 50);

    return () => {
      window.clearTimeout(kick);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("orientationchange", onScroll);
      scroller?.removeEventListener("scroll", onScroll);
      scroller?.removeEventListener("touchmove", onScroll);
      reduceQuery.removeEventListener("change", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={rootRef} className="overflow-x-hidden" id="rd-login-features">
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
            className="relative h-[560px]"
          >
            <div
              data-parallax-text
              className={`absolute top-[190px] w-[196px] will-change-transform ${fromLeft ? "right-4" : "left-6"}`}
              style={{ opacity: 0, transform: `translate3d(0, ${TEXT_SLIDE_Y}px, 0)` }}
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
              className={`absolute top-[60px] h-[440px] w-[211px] overflow-hidden rounded-[34px] border-2 border-[var(--rd-border-strong)] bg-[var(--rd-bg-base)] shadow-[0_0_40px_rgba(47,218,184,0.18)] will-change-transform ${
                fromLeft ? "left-[-70px]" : "right-[-70px]"
              }`}
              style={{
                opacity: 0.4,
                transform: `translate3d(${PHONE_SLIDE_X * dir}px, ${PHONE_SLIDE_Y}px, 0)`,
              }}
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
