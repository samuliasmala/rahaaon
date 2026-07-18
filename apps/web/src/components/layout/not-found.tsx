import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="font-display text-[52px]/none font-bold tracking-[-0.02em]">404</p>
      <p className="text-[15px] text-body">Tätä sivua ei löytynyt — sekin on vähän turhaa.</p>
      <Link to="/" className="text-sm font-semibold text-accent hover:text-accent-deep">
        Takaisin etusivulle →
      </Link>
    </div>
  );
}
