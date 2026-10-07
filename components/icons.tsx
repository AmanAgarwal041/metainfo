// One icon family: 24px grid, 1.75 stroke, round caps and joins.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode) {
  return function Icon({ size = 16, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
        {paths}
      </svg>
    );
  };
}

export const IconDashboard = make(<><rect x="4" y="4" width="7" height="9" rx="1.5" /><rect x="13" y="4" width="7" height="5" rx="1.5" /><rect x="13" y="11" width="7" height="9" rx="1.5" /><rect x="4" y="15" width="7" height="5" rx="1.5" /></>);
export const IconAudit = make(<><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" /></>);
export const IconKey = make(<><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /><path d="M8 10.5h5" /></>);
export const IconGap = make(<><path d="M4 18h4V9H4z" /><path d="M10 18h4V5h-4z" /><path d="M16 18h4v-6h-4z" strokeDasharray="2 2" /></>);
export const IconUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.5a6 6 0 0 1 3 5.5" /></>);
export const IconSerp = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h7M7 17h4" /></>);
export const IconLink = make(<><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>);
export const IconTrend = make(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>);
export const IconSpark = make(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8.5 13 11l2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" /></>);
export const IconSettings = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const IconMonitor = make(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconArrow = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconPlug = make(<><path d="M9 7V3M15 7V3" /><path d="M6 7h12v4a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>);
export const IconBolt = make(<path d="M13 3 5 14h6l-1 7 8-11h-6z" />);
export const IconCheck = make(<path d="m5 12 5 5 9-10" />);
export const IconRobot = make(<><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" /></>);
