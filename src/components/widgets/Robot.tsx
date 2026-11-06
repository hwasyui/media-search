// Kepala robot: antena, kepala berwarna perak-biru, telinga, layar wajah gelap dengan mata menyala yang berkedip. Dipakai asisten dan tur.
export default function Robot({ n, id }: { n: number; id: string }) {
  return (
    <svg viewBox="0 0 40 40" width={n} height={n} aria-hidden="true">
      <defs><linearGradient id={`rb${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4f7ff" /><stop offset="1" stopColor="#9db3e8" /></linearGradient></defs>
      <path d="M20 9V4.5" stroke="#8aa4e6" strokeWidth="2.2" strokeLinecap="round" /><circle className="rb-ant" cx="20" cy="3.6" r="2.6" fill="#ff6b8a" />
      <rect x="1.5" y="17" width="5" height="10" rx="2.5" fill="#7f97d6" /><rect x="33.5" y="17" width="5" height="10" rx="2.5" fill="#7f97d6" />
      <rect x="5" y="9" width="30" height="25" rx="8" fill={`url(#rb${id})`} stroke="#6c84c8" strokeWidth="1.4" />
      <rect x="9" y="14" width="22" height="14" rx="6" fill="#101a35" />
      <rect className="rb-eye" x="13.2" y="18" width="4.6" height="6.4" rx="2.3" fill="#5ef2ff" /><rect className="rb-eye" x="22.2" y="18" width="4.6" height="6.4" rx="2.3" fill="#5ef2ff" />
      <path d="M17 31.2h6" stroke="#6c84c8" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
