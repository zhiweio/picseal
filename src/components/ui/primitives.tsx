'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as SliderPrimitive from '@radix-ui/react-slider'

/** 直角面板：1px 边线 + eyebrow 双语标签 + 粗主规则线 */
export function Panel({
  label,
  labelEn,
  children,
  className,
  action
}: {
  label: string
  labelEn?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <section className={clsx('border-b border-line', className)}>
      <header className="rule-heavy flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="hud-label">
          {label}
          {labelEn ? <span className="text-ink/60"> / {labelEn}</span> : null}
        </h3>
        {action}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

type ButtonVariant = 'solid' | 'ghost' | 'line'

export function TermButton({
  variant = 'ghost',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex h-8 items-center justify-center gap-1.5 px-3 text-[12px] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'solid' && 'bg-ink text-page hover:opacity-85',
        variant === 'ghost' &&
          'border border-line text-ink hover:border-ink hover:bg-ink/5',
        variant === 'line' && 'text-muted hover:text-accent',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/** 方形拨杆 —— 直角是识别特征 */
export function TermSwitch({
  checked,
  onCheckedChange,
  disabled,
  ...props
}: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={clsx(
        'relative h-4 w-8 border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line bg-transparent',
        disabled && 'opacity-40'
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={clsx(
          'absolute top-[1px] block h-[12px] w-[12px] transition-transform',
          checked ? 'translate-x-[17px] bg-page' : 'translate-x-[1px] bg-muted'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export function TermSlider({
  value,
  min,
  max,
  step,
  onValueChange,
  format,
  disabled
}: {
  value: number
  min: number
  max: number
  step: number
  onValueChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
}) {
  return (
    <div className={clsx('flex items-center gap-3', disabled && 'opacity-40')}>
      <SliderPrimitive.Root
        className="relative flex h-4 flex-1 touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0]!)}
        disabled={disabled}
      >
        <SliderPrimitive.Track className="relative h-[1px] w-full grow bg-line">
          <SliderPrimitive.Range className="absolute h-full bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="value"
          className="block h-3 w-1.5 bg-ink hover:bg-accent"
        />
      </SliderPrimitive.Root>
      <span className="w-11 text-right text-[11px] tabular-nums text-muted">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex border border-line">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            'px-2.5 py-1 text-[11px] transition-colors',
            i > 0 && 'border-l border-line',
            value === opt.value ? 'bg-ink text-page' : 'text-muted hover:text-ink'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function StatusDot({ state }: { state: 'idle' | 'ok' | 'work' | 'fail' }) {
  return <span className="status-dot" data-state={state === 'idle' ? undefined : state} />
}

/** 大数字批次统计（50px/300 识别性元素） */
export function BigCount({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[28px] font-light leading-none tracking-[-1px] tabular-nums">
        {String(value).padStart(3, '0')}
      </span>
      <span className="hud-label">{label}</span>
    </div>
  )
}
