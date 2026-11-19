/**
 * Analytics Dashboard API
 */

import { NextResponse } from 'next/server';
import { AnalyticsDashboard } from '@/lib/analytics-dashboard.js';

const analyticsDashboard = new AnalyticsDashboard();

export async function POST(request) {
  try {
    const { action, data } = await request.json();
    
    let result;
    
    switch (action) {
      case 'track_writing':
        result = await analyticsDashboard.trackWritingActivity(data.projectId, data.activity);
        break;
      case 'track_compilation':
        result = await analyticsDashboard.trackCompilationActivity(data.projectId, data.activity);
        break;
      case 'track_research':
        result = await analyticsDashboard.trackResearchActivity(data.projectId, data.activity);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in analytics dashboard:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const action = searchParams.get('action');
    const period = searchParams.get('period') || 'month';
    
    let result;
    
    switch (action) {
      case 'project_analytics':
        if (!projectId) {
          return NextResponse.json(
            { error: 'Project ID is required' },
            { status: 400 }
          );
        }
        result = await analyticsDashboard.getProjectAnalytics(projectId);
        break;
      case 'global_analytics':
        result = await analyticsDashboard.getGlobalAnalytics();
        break;
      case 'productivity_insights':
        if (!projectId) {
          return NextResponse.json(
            { error: 'Project ID is required' },
            { status: 400 }
          );
        }
        result = await analyticsDashboard.getProductivityInsights(projectId);
        break;
      case 'productivity_report':
        if (!projectId) {
          return NextResponse.json(
            { error: 'Project ID is required' },
            { status: 400 }
          );
        }
        result = await analyticsDashboard.generateProductivityReport(projectId, period);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting analytics data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
