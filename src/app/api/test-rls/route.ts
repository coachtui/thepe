import { createClient } from '@/lib/db/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Test 1: Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    // Test 2: Call the auth context test function
    const { data: authContext, error: authError } = await (supabase as any)
      .rpc('test_auth_context')

    // Test 3: Try to read from users table (should work with RLS)
    const { data: userRecord, error: userRecordError } = user?.id
      ? await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single()
      : { data: null, error: { message: 'No user ID' } }

    // Test 4: Check what get_user_organization_id() returns
    const { data: orgIdFromHelper, error: orgIdError } = await (supabase as any)
      .rpc('get_user_organization_id')

    // Test 5: Try to insert into projects using secure RPC function
    const { data: testProject, error: projectError } = await (supabase as any)
      .rpc('create_project_secure', {
        p_name: 'RLS Test Project ' + Date.now(),
        p_description: 'Testing secure function'
      })

    return NextResponse.json({
      success: !projectError,
      tests: {
        user: {
          success: !userError,
          data: user ? { id: user.id, email: user.email } : null,
          error: userError?.message
        },
        authContext: {
          success: !authError,
          data: authContext,
          error: authError?.message
        },
        userRecord: {
          success: !userRecordError,
          data: userRecord ? { id: userRecord.id, organization_id: userRecord.organization_id } : null,
          error: userRecordError?.message
        },
        helperFunctionTest: {
          success: !orgIdError,
          data: orgIdFromHelper,
          expected: userRecord?.organization_id,
          matches: orgIdFromHelper === userRecord?.organization_id,
          error: orgIdError?.message
        },
        projectInsert: {
          success: !projectError,
          data: testProject,
          error: projectError?.message,
          errorDetails: projectError
        }
      }
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
