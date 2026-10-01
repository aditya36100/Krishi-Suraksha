import React from 'react';

function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        background: '#ffffff',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.75rem' }}>🌱</span>
          <div>
            <h1 style={{ fontSize: '1.25rem', color: 'var(--primary-dark)' }}>Krishi Suraksha</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Farmer-to-Buyer Marketplace for High-Value Crops</p>
          </div>
        </div>
        <span style={{
          background: 'var(--primary-light)',
          color: 'var(--primary-dark)',
          padding: '0.35rem 0.75rem',
          borderRadius: 'var(--radius-full)',
          fontSize: '0.8rem',
          fontWeight: 600
        }}>
          Phase 1: Environment Initialized
        </span>
      </header>

      <main style={{ flex: 1, padding: '3rem 2rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          padding: '2.5rem',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--border-subtle)'
        }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Krishi Suraksha Marketplace Engine</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Direct advance contracting platform connecting verified Indian farmers of high-value crops with bulk commercial buyers.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginTop: '1.5rem'
          }}>
            <div style={{ padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 600, color: 'var(--primary)' }}>Backend Service</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Node.js + Express + Prisma ORM</div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 600, color: 'var(--primary)' }}>Fair-Price ML Service</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Python + FastAPI + Agmarknet Insights</div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 600, color: 'var(--primary)' }}>Mobile Farmer App</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>React Native Expo (English + Kannada)</div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 600, color: 'var(--primary)' }}>Buyer & Admin Web</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>React + Vite + Razorpay Gateway</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
