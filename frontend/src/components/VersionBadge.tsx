import React from 'react';
import './VersionBadge.css';

const VERSION_LABEL = import.meta.env.VITE_FRONTEND_VERSION ?? 'v1.0';

export const VersionBadge: React.FC = () => (
    <div className="version-badge" aria-label="Frontend version">
        {VERSION_LABEL}
    </div>
);
