'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

const Spline = lazy(() => import('@splinetool/react-spline'));

export type SplineProps = ComponentProps<typeof Spline>;

export function LazySpline(props: SplineProps) {
  return (
    <Suspense fallback={null}>
      <Spline {...props} />
    </Suspense>
  );
}
