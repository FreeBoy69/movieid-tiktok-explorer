export function SiteFooter({ theme = "dark" }: { theme?: "light" | "dark" }) {
  const year = new Date().getFullYear();
  return (
    <footer className="site-foot" data-theme={theme}>
      <p>© {year} AutoYT</p>
      <nav aria-label="Legal">
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
      </nav>
    </footer>
  );
}
