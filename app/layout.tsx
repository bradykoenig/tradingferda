import "./globals.css";

export const metadata = {
  title: "Schlima - Daily Playbook",
  description: "Free, explainable trade ideas generated from public EOD data."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
          {children}
        </div>
      </body>
    </html>
  );
}
