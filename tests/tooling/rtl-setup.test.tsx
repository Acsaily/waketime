// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('RTL/jsdom setup', () => {
  it('renders React and exposes jest-dom matchers', () => {
    render(<p>清醒时光</p>);
    expect(screen.getByText('清醒时光')).toBeInTheDocument();
  });
});
