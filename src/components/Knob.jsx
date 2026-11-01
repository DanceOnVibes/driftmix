import { useRef } from "react";

/**
 * A DJ mixer knob. Drag up/down (or scroll, or arrow keys) to turn;
 * double-click to snap back to the middle. Bipolar knobs (−1 … +1) have a
 * centre detent; effect knobs run 0 … 1.
 */
export function Knob({ label, value, onChange, bipolar = true, readout, killed = false, testid, disabled = false }) {
  const drag = useRef(null);
  const min = bipolar ? -1 : 0;
  const clamp = (v) => {
    let x = Math.max(min, Math.min(1, v));
    if (bipolar && Math.abs(x) < 0.04) x = 0; // the centre detent
    return Math.round(x * 100) / 100;
  };
  const turn = (v) => !disabled && onChange(clamp(v));
  const angle = -135 + ((value - min) / (1 - min)) * 270;
  const r = 20;
  const arc = (from, to) => {
    const p = (a) => [26 + r * Math.sin((a * Math.PI) / 180), 26 - r * Math.cos((a * Math.PI) / 180)];
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x2} ${y2}`;
  };
  const zero = bipolar ? 0 : -135;
  return (
    <div className={`knob${killed ? " knob-killed" : ""}${disabled ? " knob-off" : ""}`}>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={readout}
        aria-disabled={disabled}
        data-testid={testid}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dy = drag.current.y - e.clientY;
          turn(drag.current.v + (dy / 150) * (1 - min) * (e.shiftKey ? 0.25 : 1));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => turn(bipolar ? 0 : 0)}
        onWheel={(e) => {
          if (disabled) return;
          turn(value + (e.deltaY < 0 ? 0.05 : -0.05));
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.01 : 0.05;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") turn(value + step);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") turn(value - step);
          else if (e.key === "Home" || e.key === "0") turn(0);
          else return;
          e.preventDefault();
        }}
      >
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
          <path d={arc(-135, 135)} className="knob-track" />
          {value !== (bipolar ? 0 : 0) && <path d={angle > zero ? arc(zero, angle) : arc(angle, zero)} className="knob-value" />}
          <circle cx="26" cy="26" r="14" className="knob-cap" />
          <line x1="26" y1="26" x2={26 + 12 * Math.sin((angle * Math.PI) / 180)} y2={26 - 12 * Math.cos((angle * Math.PI) / 180)} className="knob-pointer" />
        </svg>
      </div>
      <span className="knob-label">{label}</span>
      <span className="knob-readout">{readout}</span>
    </div>
  );
}
