// Simple chart rendering without external dependencies
function createChart(canvasId, type, data, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width || 400;
  const height = canvas.height || 300;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  const colors = {
    primary: '#1a56db',
    primaryLight: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    grid: '#e2e8f0'
  };

  // Check dark mode
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    colors.grid = '#334155';
  }

  if (type === 'bar') {
    drawBarChart(ctx, data, width, height, colors, options);
  } else if (type === 'line') {
    drawLineChart(ctx, data, width, height, colors, options);
  } else if (type === 'pie') {
    drawPieChart(ctx, data, width, height, colors, options);
  } else if (type === 'doughnut') {
    drawDoughnutChart(ctx, data, width, height, colors, options);
  }
}

function drawBarChart(ctx, data, width, height, colors, options) {
  const padding = { top: 30, right: 20, bottom: 50, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const labels = data.labels || [];
  const values = data.values || [];
  const maxValue = Math.max(...values, 1);

  // Draw grid
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 0.5;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartHeight / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    // Y-axis labels
    const value = Math.round(maxValue - (maxValue / gridLines) * i);
    ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(value, padding.left - 10, y + 4);
  }

  // Draw bars
  const barWidth = (chartWidth / labels.length) * 0.6;
  const barGap = (chartWidth / labels.length) * 0.4;

  values.forEach((value, index) => {
    const x = padding.left + (chartWidth / labels.length) * index + barGap / 2;
    const barHeight = (value / maxValue) * chartHeight;
    const y = padding.top + chartHeight - barHeight;

    // Gradient
    const gradient = ctx.createLinearGradient(x, y, x, padding.top + chartHeight);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(1, colors.primaryLight);
    ctx.fillStyle = gradient;

    // Rounded top
    const radius = 4;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barWidth - radius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
    ctx.lineTo(x + barWidth, padding.top + chartHeight);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();

    // X-axis labels
    ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[index] || '', x + barWidth / 2, padding.top + chartHeight + 20);

    // Value on top
    ctx.fillStyle = isDark() ? '#f1f5f9' : '#0f172a';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText(value, x + barWidth / 2, y - 8);
  });
}

function drawLineChart(ctx, data, width, height, colors, options) {
  const padding = { top: 30, right: 30, bottom: 50, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const labels = data.labels || [];
  const values = data.values || [];
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);

  // Draw grid
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 0.5;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartHeight / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    const value = Math.round(maxValue - ((maxValue - minValue) / gridLines) * i);
    ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(value, padding.left - 10, y + 4);
  }

  // Draw line
  ctx.beginPath();
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';

  const points = values.map((value, index) => {
    const x = padding.left + (chartWidth / (values.length - 1)) * index;
    const y = padding.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;
    return { x, y };
  });

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, 'rgba(26,86,219,0.2)');
  gradient.addColorStop(1, 'rgba(26,86,219,0)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, padding.top + chartHeight);
  points.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, padding.top + chartHeight);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  points.forEach((point, i) => {
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  // Points
  points.forEach(point => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.primary;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // X-axis labels
  labels.forEach((label, i) => {
    if (i % Math.ceil(labels.length / 8) === 0 || i === labels.length - 1) {
      const x = padding.left + (chartWidth / (values.length - 1)) * i;
      ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, padding.top + chartHeight + 20);
    }
  });
}

function drawPieChart(ctx, data, width, height, colors, options) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 30;

  const pieColors = ['#1a56db', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
  const values = data.values || [];
  const labels = data.labels || [];
  const total = values.reduce((sum, v) => sum + v, 0);

  let startAngle = -Math.PI / 2;

  values.forEach((value, i) => {
    const sliceAngle = (value / total) * Math.PI * 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = pieColors[i % pieColors.length];
    ctx.fill();

    // Label
    const midAngle = startAngle + sliceAngle / 2;
    const labelX = centerX + Math.cos(midAngle) * (radius * 0.7);
    const labelY = centerY + Math.sin(midAngle) * (radius * 0.7);
    
    if (value / total > 0.05) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round((value / total) * 100)}%`, labelX, labelY);
    }

    startAngle += sliceAngle;
  });

  // Legend
  const legendY = height - 20;
  labels.forEach((label, i) => {
    const x = 40 + i * 80;
    ctx.fillStyle = pieColors[i % pieColors.length];
    ctx.fillRect(x, legendY, 10, 10);
    ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 14, legendY + 9);
  });
}

function drawDoughnutChart(ctx, data, width, height, colors, options) {
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) / 2 - 30;
  const innerRadius = outerRadius * 0.6;

  const doughnutColors = ['#10b981', '#f59e0b', '#ef4444', '#1a56db'];
  const values = data.values || [];
  const labels = data.labels || [];
  const total = values.reduce((sum, v) => sum + v, 0);

  let startAngle = -Math.PI / 2;

  values.forEach((value, i) => {
    const sliceAngle = (value / total) * Math.PI * 2;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, startAngle, startAngle + sliceAngle);
    ctx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = doughnutColors[i % doughnutColors.length];
    ctx.fill();

    startAngle += sliceAngle;
  });

  // Center text
  ctx.fillStyle = isDark() ? '#f1f5f9' : '#0f172a';
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.centerText || `${total}`, centerX, centerY - 4);
  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
  ctx.fillText(data.centerLabel || 'Total', centerX, centerY + 14);

  // Legend
  labels.forEach((label, i) => {
    const y = 30 + i * 25;
    ctx.fillStyle = doughnutColors[i % doughnutColors.length];
    ctx.beginPath();
    ctx.arc(30, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isDark() ? '#94a3b8' : '#475569';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label}: ${values[i]}`, 42, y + 4);
  });
}

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// Expose globally
window.FusionCharts = {
  createChart
};
