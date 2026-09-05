export function HeroDiagram() {
  return (
    <svg
      viewBox="0 0 470 330"
      role="img"
      aria-label="A failed payment is classified, then either retried at the right moment or abandoned when no retry can work."
      className="hero-diagram w-full max-w-[470px]"
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
          x="1"
          y="140"
          width="118"
          height="50"
          rx="2"
          fill="#1c202b"
          stroke="#333846"
        />
        <text x="14" y="162" fill="#8b8f98" fontSize="9.5">
          ₹28,190 stuck
        </text>
        <text x="14" y="178" fill="#e4e6ea" fontSize="10.5">
          payment_cancelled
        </text>

        <path
          className="hd-line"
          d="M119 165 H 156"
          stroke="#4a5060"
          strokeWidth="1.5"
          fill="none"
        />

        <circle cx="192" cy="165" r="34" fill="#1c202b" stroke="#4a5060" />
        <circle className="hd-ring" cx="192" cy="165" r="34" fill="none" stroke="#3ddc84" />
        <text x="192" y="162" fill="#e4e6ea" fontSize="10.5" textAnchor="middle">
          why?
        </text>
        <text x="192" y="176" fill="#8b8f98" fontSize="8.5" textAnchor="middle">
          classify
        </text>

        <path
          className="hd-line hd-good"
          d="M228 158 C 268 152, 272 92, 312 92"
          stroke="#3ddc84"
          strokeWidth="1.5"
          fill="none"
          markerEnd="url(#tip-good)"
        />
        <path
          className="hd-line hd-warn"
          d="M228 174 C 268 182, 272 245, 312 245"
          stroke="#f0b429"
          strokeWidth="1.5"
          fill="none"
          markerEnd="url(#tip-warn)"
        />

        <rect
          x="322"
          y="62"
          width="146"
          height="60"
          rx="2"
          fill="#14261d"
          stroke="#2f6b48"
        />
        <text x="336" y="82" fill="#3ddc84" fontSize="9">
          balance problem
        </text>
        <text x="336" y="98" fill="#e4e6ea" fontSize="10.5">
          retry on payday
        </text>
        <text x="336" y="113" fill="#8b8f98" fontSize="9">
          money comes back
        </text>

        <rect
          x="322"
          y="215"
          width="146"
          height="60"
          rx="2"
          fill="#2a2113"
          stroke="#7a5a1c"
        />
        <text x="336" y="235" fill="#f0b429" fontSize="9">
          permission revoked
        </text>
        <text x="336" y="251" fill="#e4e6ea" fontSize="10.5">
          stop, on purpose
        </text>
        <text x="336" y="266" fill="#8b8f98" fontSize="9">
          no retry can work
        </text>

        <text x="1" y="308" fill="#6c7180" fontSize="9">
          one in four rupees is unrecoverable. knowing which is the whole idea.
        </text>
      </g>
    </svg>
  );
}
