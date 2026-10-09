import { useEffect, useRef, type CSSProperties } from "react";

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

/**
 * Login feature parallax — CSS phone frame + Figma @2x screen exports.
 * Scroll uses capture so it works when the page scrolls inside a nested container.
 */
export function FeatureParallax() {
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const update = () => {
      raf = 0;
      const reduce = reduceQuery.matches;
      const vh = window.innerHeight;
      for (const el of refs.current) {
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        // 0 = section just entered bottom, 1 = its top is at 35% of viewport height
        const p = reduce ? 1 : Math.min(1, Math.max(0, (vh - top) / (vh * 0.65)));
        el.style.setProperty("--p", p.toFixed(3));
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    reduceQuery.addEventListener("change", onScroll);
    update();
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      reduceQuery.removeEventListener("change", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="overflow-x-hidden" id="rd-login-features">
      {FEATURES.map((feature, i) => {
        const fromLeft = i % 2 === 1;
        return (
          <section
            key={feature.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="relative h-[560px]"
            style={
              {
                ["--p" as string]: 0,
                ["--dir" as string]: fromLeft ? -1 : 1,
              } as CSSProperties
            }
          >
            <div
              className={`absolute top-[190px] w-[196px] ${fromLeft ? "right-4" : "left-6"}`}
              style={{
                opacity: "clamp(0, calc(var(--p) * 2), 1)",
                transform: "translateY(calc((1 - min(1, var(--p) * 2)) * 24px))",
              }}
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
              className={`absolute top-[60px] h-[440px] w-[211px] overflow-hidden rounded-[34px] border-2 border-[var(--rd-border-strong)] bg-[var(--rd-bg-base)] shadow-[0_0_40px_rgba(47,218,184,0.18)] will-change-transform ${
                fromLeft ? "left-[-70px]" : "right-[-70px]"
              }`}
              style={{
                opacity: "calc(0.4 + 0.6 * var(--p))",
                transform:
                  "translate3d(calc((1 - var(--p)) * 160px * var(--dir)), calc((1 - var(--p)) * 40px), 0)",
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
