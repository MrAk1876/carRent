import React, { useEffect, useRef, useState } from 'react';

const directionToClass = {
  up: 'translate-y-8',
  down: '-translate-y-8',
  left: '-translate-x-8',
  right: 'translate-x-8',
  none: '',
};

const ScrollReveal = ({ children, className = '', direction = 'up', delay = 0, once = true, ...props }) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold: 0.18 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [once]);

  const hiddenTransform = directionToClass[direction] || directionToClass.up;

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 will-change-transform ${
        visible ? 'opacity-100 translate-x-0 translate-y-0 blur-0' : `opacity-0 ${hiddenTransform} blur-[2px]`
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export default ScrollReveal;
