import React from 'react';

interface ScrollingTitleProps {
  as?: 'h1' | 'h2';
  className?: string;
  children: React.ReactNode;
}

export const ScrollingTitle: React.FC<ScrollingTitleProps> = ({
  as = 'h2',
  className = '',
  children,
}) => {
  const Tag = as;

  return (
    <Tag className={`scrolling-title-wrap block w-full ${className}`}>
      <span className="scrolling-title-track">
        <span className="pr-12">{children}</span>
        <span className="pr-12" aria-hidden="true">
          {children}
        </span>
      </span>
    </Tag>
  );
};
