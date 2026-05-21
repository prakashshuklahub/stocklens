export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      {children}
    </div>
  )
}
