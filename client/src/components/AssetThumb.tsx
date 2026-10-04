import { useEffect, useState } from "react";

function useFinePointer(): boolean {
  const [fine, setFine] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setFine(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return fine;
}

type Props = {
  src: string;
  alt: string;
  size?: "sm" | "md";
};

/** Malý náhľad aktíva. Na počítači sa zväčší pri hoveri, na mobile po kliknutí. */
export function AssetThumb({ src, alt, size = "md" }: Props) {
  const finePointer = useFinePointer();
  const [open, setOpen] = useState(false);
  const box = size === "md" ? "h-10 w-10" : "h-8 w-8";

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => {
        if (finePointer) setOpen(true);
      }}
      onMouseLeave={() => {
        if (finePointer) setOpen(false);
      }}
      onClick={(event) => {
        if (finePointer) return;
        event.stopPropagation();
        event.preventDefault();
        setOpen((current) => !current);
      }}
    >
      <img src={src} alt={alt} className={`${box} rounded-md object-contain bg-muted`} />
      {open && finePointer ? (
        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 rounded-md border bg-background p-1 shadow-lg">
          <img src={src} alt="" className="h-44 w-auto max-w-[12rem] object-contain" />
        </span>
      ) : null}
      {open && !finePointer ? (
        <span
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            setOpen(false);
          }}
        >
          <img src={src} alt={alt} className="max-h-[70vh] max-w-full object-contain" />
        </span>
      ) : null}
    </span>
  );
}
