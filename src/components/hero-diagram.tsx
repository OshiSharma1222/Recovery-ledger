export function HeroDiagram() {
  return (
    <svg
      viewBox="0 0 340 392"
      role="img"
      aria-label="A failed payment is classified, then either retried at the right moment or abandoned when no retry can work."
      className="hero-diagram mx-auto w-full max-w-[320px]"
    >
      <defs>
        <marker
          id="tip-good"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 1 L6 4 L0 7" fill="none" stroke="#3ddc84" strokeWidth="1.4" />
        </marker>
        <marker
          id="tip-warn"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 1 L6 4 L0 7" fill="none" stroke="#f0b429" strokeWidth="1.4" />
        </marker>
      </defs>

      <g fontFamily="var(--font-jbmono), ui-monospace, monospace">
        <rect
          x="85"
          y="2"
          width="170"
          height="54"
          rx="2"
          fill="#1c202b"
          stroke="#333846"
        />
        <text x="99" y="24" fill="#8b8f98" fontSize="9">
          ₹28,190 stuck
        </text>
        <text x="99" y="41" fill="#e4e6ea" fontSize="10.5">
          payment_cancelled
        </text>

        <path
          className="hd-line"
          d="M170 56 V 92"
          stroke="#4a5060"
          strokeWidth="1.5"
          fill="none"
        />

        <circle cx="170" cy="128" r="36" fill="#1c202b" stroke="#4a5060" />
        <circle className="hd-ring" cx="170" cy="128" r="36" fill="none" stroke="#3ddc84" />
        <text x="170" y="124" fill="#e4e6ea" fontSize="10.5" textAnchor="middle">
          why did
        </text>
        <text x="170" y="139" fill="#e4e6ea" fontSize="10.5" textAnchor="middle">
          it fail?
        </text>

        <path
          className="hd-line hd-good"
          d="M170 164 C 170 212, 82 206, 82 246"
          stroke="#3ddc84"
          strokeWidth="1.5"
          fill="none"
          markerEnd="url(#tip-good)"
        />
        <path
          className="hd-line hd-warn"
          d="M170 164 C 170 212, 258 206, 258 246"
          stroke="#f0b429"
          strokeWidth="1.5"
          fill="none"
          markerEnd="url(#tip-warn)"
        />

        <rect
          x="2"
          y="256"
          width="160"
          height="72"
          rx="2"
          fill="#14261d"
          stroke="#2f6b48"
        />
        <text x="14" y="277" fill="#3ddc84" fontSize="9">
          balance problem
        </text>
        <text x="14" y="295" fill="#e4e6ea" fontSize="10.5">
          retry on payday
        </text>
        <text x="14" y="313" fill="#8b8f98" fontSize="9">
          money comes back
        </text>

        <rect
          x="178"
          y="256"
          width="160"
          height="72"
          rx="2"
          fill="#2a2113"
          stroke="#7a5a1c"
        />
        <text x="190" y="277" fill="#f0b429" fontSize="9">
          permission gone
        </text>
        <text x="190" y="295" fill="#e4e6ea" fontSize="10.5">
          stop, on purpose
        </text>
        <text x="190" y="313" fill="#8b8f98" fontSize="9">
          no retry can work
        </text>

        <text x="170" y="358" fill="#6c7180" fontSize="9" textAnchor="middle">
          one in four rupees is unrecoverable.
        </text>
        <text x="170" y="374" fill="#6c7180" fontSize="9" textAnchor="middle">
          knowing which is the whole idea.
        </text>
      </g>
    </svg>
  );
}
