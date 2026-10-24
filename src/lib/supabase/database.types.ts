
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "assessment_attempts": {
                  Row: {
                    "assessment_id": string,"attempt_no": number,"auto_submitted": boolean,"deadline_at": string | null,"id": string,"max_score": number | null,"question_order": (string)[],"score": number | null,"started_at": string,"status": string,"student_id": string,"submitted_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assessment_id": string,"attempt_no"?: number,"auto_submitted"?: boolean,"deadline_at"?: string | null,"id"?: string,"max_score"?: number | null,"question_order"?: (string)[],"score"?: number | null,"started_at"?: string,"status"?: string,"student_id": string,"submitted_at"?: string | null
                  }
                  Update: {
                    "assessment_id"?: string,"attempt_no"?: number,"auto_submitted"?: boolean,"deadline_at"?: string | null,"id"?: string,"max_score"?: number | null,"question_order"?: (string)[],"score"?: number | null,"started_at"?: string,"status"?: string,"student_id"?: string,"submitted_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "assessment_attempts_assessment_id_fkey"
      columns: ["assessment_id"]
isOneToOne: false
      referencedRelation: "assessments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assessment_attempts_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"assessment_questions": {
                  Row: {
                    "assessment_id": string,"marks": number,"ordering": number,"question_version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assessment_id": string,"marks"?: number,"ordering": number,"question_version_id": string
                  }
                  Update: {
                    "assessment_id"?: string,"marks"?: number,"ordering"?: number,"question_version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assessment_questions_assessment_id_fkey"
      columns: ["assessment_id"]
isOneToOne: false
      referencedRelation: "assessments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assessment_questions_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"assessments": {
                  Row: {
                    "answers_released_at": string | null,"created_at": string,"created_by": string,"description": string | null,"id": string,"is_seed": boolean,"published_at": string | null,"results_released_at": string | null,"seq": number,"settings": NonNullable<Json>,"status": string,"title": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers_released_at"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"is_seed"?: boolean,"published_at"?: string | null,"results_released_at"?: string | null,"seq"?: never,"settings"?: NonNullable<Json>,"status"?: string,"title": string,"type"?: string,"updated_at"?: string
                  }
                  Update: {
                    "answers_released_at"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"is_seed"?: boolean,"published_at"?: string | null,"results_released_at"?: string | null,"seq"?: never,"settings"?: NonNullable<Json>,"status"?: string,"title"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assessments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"attempt_answers": {
                  Row: {
                    "attempt_id": string,"marked_for_review": boolean,"option_order": (string)[] | null,"question_version_id": string,"selected_option_ids": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_id": string,"marked_for_review"?: boolean,"option_order"?: (string)[] | null,"question_version_id": string,"selected_option_ids"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "attempt_id"?: string,"marked_for_review"?: boolean,"option_order"?: (string)[] | null,"question_version_id"?: string,"selected_option_ids"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attempt_answers_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: false
      referencedRelation: "assessment_attempts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attempt_answers_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"attempt_grades": {
                  Row: {
                    "attempt_id": string,"awarded_marks": number,"is_correct": boolean,"max_marks": number,"question_version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_id": string,"awarded_marks": number,"is_correct": boolean,"max_marks": number,"question_version_id": string
                  }
                  Update: {
                    "attempt_id"?: string,"awarded_marks"?: number,"is_correct"?: boolean,"max_marks"?: number,"question_version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attempt_grades_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: false
      referencedRelation: "assessment_attempts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attempt_grades_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"code_drafts": {
                  Row: {
                    "question_version_id": string,"source_code": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "question_version_id": string,"source_code": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "question_version_id"?: string,"source_code"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "code_drafts_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "code_drafts_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"code_runs": {
                  Row: {
                    "created_at": string,"id": string,"question_version_id": string,"source_code": string,"student_id": string,"verdict": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"question_version_id": string,"source_code": string,"student_id": string,"verdict"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"question_version_id"?: string,"source_code"?: string,"student_id"?: string,"verdict"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "code_runs_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "code_runs_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"code_submission_private": {
                  Row: {
                    "detailed_results": NonNullable<Json>,"submission_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "detailed_results"?: NonNullable<Json>,"submission_id": string
                  }
                  Update: {
                    "detailed_results"?: NonNullable<Json>,"submission_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "code_submission_private_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: true
      referencedRelation: "code_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"code_submissions": {
                  Row: {
                    "attempts_count": number,"claimed_at": string | null,"compile_output": string | null,"completed_at": string | null,"error_message": string | null,"exec_time_ms": number | null,"id": string,"idempotency_key": string,"language": string,"marks_awarded": number | null,"max_marks": number | null,"memory_kb": number | null,"passed_hidden": number | null,"passed_public": number | null,"question_version_id": string,"results": NonNullable<Json>,"score_pct": number | null,"source_code": string,"status": string,"student_id": string,"submitted_at": string,"total_hidden": number | null,"total_public": number | null,"verdict": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts_count"?: number,"claimed_at"?: string | null,"compile_output"?: string | null,"completed_at"?: string | null,"error_message"?: string | null,"exec_time_ms"?: number | null,"id"?: string,"idempotency_key": string,"language"?: string,"marks_awarded"?: number | null,"max_marks"?: number | null,"memory_kb"?: number | null,"passed_hidden"?: number | null,"passed_public"?: number | null,"question_version_id": string,"results"?: NonNullable<Json>,"score_pct"?: number | null,"source_code": string,"status"?: string,"student_id": string,"submitted_at"?: string,"total_hidden"?: number | null,"total_public"?: number | null,"verdict"?: string | null
                  }
                  Update: {
                    "attempts_count"?: number,"claimed_at"?: string | null,"compile_output"?: string | null,"completed_at"?: string | null,"error_message"?: string | null,"exec_time_ms"?: number | null,"id"?: string,"idempotency_key"?: string,"language"?: string,"marks_awarded"?: number | null,"max_marks"?: number | null,"memory_kb"?: number | null,"passed_hidden"?: number | null,"passed_public"?: number | null,"question_version_id"?: string,"results"?: NonNullable<Json>,"score_pct"?: number | null,"source_code"?: string,"status"?: string,"student_id"?: string,"submitted_at"?: string,"total_hidden"?: number | null,"total_public"?: number | null,"verdict"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "code_submissions_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "code_submissions_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"coding_configs": {
                  Row: {
                    "allow_custom_input": boolean,"compare_mode": string,"editable_scope": string,"execution_mode": string,"float_tolerance": number,"function_signature": string | null,"grading_mode": string,"language": string,"memory_limit_mb": number,"question_version_id": string,"reveal_hidden": boolean,"starter_code": string,"time_limit_ms": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_custom_input"?: boolean,"compare_mode"?: string,"editable_scope"?: string,"execution_mode"?: string,"float_tolerance"?: number,"function_signature"?: string | null,"grading_mode"?: string,"language"?: string,"memory_limit_mb"?: number,"question_version_id": string,"reveal_hidden"?: boolean,"starter_code": string,"time_limit_ms"?: number
                  }
                  Update: {
                    "allow_custom_input"?: boolean,"compare_mode"?: string,"editable_scope"?: string,"execution_mode"?: string,"float_tolerance"?: number,"function_signature"?: string | null,"grading_mode"?: string,"language"?: string,"memory_limit_mb"?: number,"question_version_id"?: string,"reveal_hidden"?: boolean,"starter_code"?: string,"time_limit_ms"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "coding_configs_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: true
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"coding_secrets": {
                  Row: {
                    "boilerplate_source": string | null,"last_validation": Json | null,"question_version_id": string,"reference_solution": string | null,"template_prefix": string,"template_suffix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "boilerplate_source"?: string | null,"last_validation"?: Json | null,"question_version_id": string,"reference_solution"?: string | null,"template_prefix"?: string,"template_suffix"?: string
                  }
                  Update: {
                    "boilerplate_source"?: string | null,"last_validation"?: Json | null,"question_version_id"?: string,"reference_solution"?: string | null,"template_prefix"?: string,"template_suffix"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coding_secrets_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: true
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"imports": {
                  Row: {
                    "created_at": string,"created_by": string,"extraction_metadata": NonNullable<Json>,"file_name": string | null,"id": string,"kind": string,"page_count": number | null,"raw_text": string | null,"status": string,"storage_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"extraction_metadata"?: NonNullable<Json>,"file_name"?: string | null,"id"?: string,"kind": string,"page_count"?: number | null,"raw_text"?: string | null,"status": string,"storage_path"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"extraction_metadata"?: NonNullable<Json>,"file_name"?: string | null,"id"?: string,"kind"?: string,"page_count"?: number | null,"raw_text"?: string | null,"status"?: string,"storage_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "imports_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"mcq_correct_options": {
                  Row: {
                    "option_id": string,"question_version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "option_id": string,"question_version_id": string
                  }
                  Update: {
                    "option_id"?: string,"question_version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mcq_correct_options_option_id_fkey"
      columns: ["option_id"]
isOneToOne: true
      referencedRelation: "mcq_options"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mcq_correct_options_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"mcq_options": {
                  Row: {
                    "display_order": number,"id": string,"option_text": string,"question_version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "display_order": number,"id"?: string,"option_text": string,"question_version_id": string
                  }
                  Update: {
                    "display_order"?: number,"id"?: string,"option_text"?: string,"question_version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mcq_options_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "body": string | null,"created_at": string,"id": string,"link": string | null,"read_at": string | null,"recipient_id": string,"reference_id": string | null,"title": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"id"?: string,"link"?: string | null,"read_at"?: string | null,"recipient_id": string,"reference_id"?: string | null,"title": string,"type": string
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"id"?: string,"link"?: string | null,"read_at"?: string | null,"recipient_id"?: string,"reference_id"?: string | null,"title"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id": string,"role": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"role"?: string
                  }
                  Relationships: [
                    
                  ]
                },"question_secrets": {
                  Row: {
                    "explanation_md": string | null,"question_version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "explanation_md"?: string | null,"question_version_id": string
                  }
                  Update: {
                    "explanation_md"?: string | null,"question_version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_secrets_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: true
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"question_versions": {
                  Row: {
                    "code_snippet": string | null,"company": string | null,"constraints_md": string | null,"created_at": string,"difficulty": string,"est_minutes": number | null,"examples": NonNullable<Json>,"id": string,"image_path": string | null,"input_format": string | null,"marks": number,"mcq_multi": boolean,"output_format": string | null,"published_at": string | null,"question_id": string,"review_flags": NonNullable<Json>,"statement_md": string,"tags": (string)[],"title": string,"topic": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code_snippet"?: string | null,"company"?: string | null,"constraints_md"?: string | null,"created_at"?: string,"difficulty"?: string,"est_minutes"?: number | null,"examples"?: NonNullable<Json>,"id"?: string,"image_path"?: string | null,"input_format"?: string | null,"marks"?: number,"mcq_multi"?: boolean,"output_format"?: string | null,"published_at"?: string | null,"question_id": string,"review_flags"?: NonNullable<Json>,"statement_md"?: string,"tags"?: (string)[],"title": string,"topic"?: string | null,"updated_at"?: string,"version": number
                  }
                  Update: {
                    "code_snippet"?: string | null,"company"?: string | null,"constraints_md"?: string | null,"created_at"?: string,"difficulty"?: string,"est_minutes"?: number | null,"examples"?: NonNullable<Json>,"id"?: string,"image_path"?: string | null,"input_format"?: string | null,"marks"?: number,"mcq_multi"?: boolean,"output_format"?: string | null,"published_at"?: string | null,"question_id"?: string,"review_flags"?: NonNullable<Json>,"statement_md"?: string,"tags"?: (string)[],"title"?: string,"topic"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_versions_question_id_fkey"
      columns: ["question_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id"]
    }
                  ]
                },"questions": {
                  Row: {
                    "created_at": string,"created_by": string,"current_version_id": string | null,"id": string,"import_id": string | null,"is_seed": boolean,"published_version_id": string | null,"seq": number,"status": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"current_version_id"?: string | null,"id"?: string,"import_id"?: string | null,"is_seed"?: boolean,"published_version_id"?: string | null,"seq"?: never,"status"?: string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"current_version_id"?: string | null,"id"?: string,"import_id"?: string | null,"is_seed"?: boolean,"published_version_id"?: string | null,"seq"?: never,"status"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "questions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "questions_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "questions_import_id_fkey"
      columns: ["import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "questions_published_version_fk"
      columns: ["published_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "attempt_id": string | null,"code_submission_id": string | null,"comments": string | null,"created_at": string,"explanation": string | null,"id": string,"marks": number | null,"max_marks": number | null,"published_at": string | null,"reviewer_id": string,"status": string,"suggestions": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_id"?: string | null,"code_submission_id"?: string | null,"comments"?: string | null,"created_at"?: string,"explanation"?: string | null,"id"?: string,"marks"?: number | null,"max_marks"?: number | null,"published_at"?: string | null,"reviewer_id": string,"status": string,"suggestions"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "attempt_id"?: string | null,"code_submission_id"?: string | null,"comments"?: string | null,"created_at"?: string,"explanation"?: string | null,"id"?: string,"marks"?: number | null,"max_marks"?: number | null,"published_at"?: string | null,"reviewer_id"?: string,"status"?: string,"suggestions"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: true
      referencedRelation: "assessment_attempts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_code_submission_id_fkey"
      columns: ["code_submission_id"]
isOneToOne: true
      referencedRelation: "code_submissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"test_cases": {
                  Row: {
                    "created_at": string,"expected_output": string,"id": string,"input": string,"label": string | null,"ordering": number,"question_version_id": string,"visibility": string,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expected_output"?: string,"id"?: string,"input"?: string,"label"?: string | null,"ordering"?: number,"question_version_id": string,"visibility"?: string,"weight"?: number
                  }
                  Update: {
                    "created_at"?: string,"expected_output"?: string,"id"?: string,"input"?: string,"label"?: string | null,"ordering"?: number,"question_version_id"?: string,"visibility"?: string,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "test_cases_question_version_id_fkey"
      columns: ["question_version_id"]
isOneToOne: false
      referencedRelation: "question_versions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "assert_admin":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_student":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"new_draft_version":
{ Args: { "p_question_id": string }; Returns: string
                           },
"publish_assessment":
{ Args: { "p_assessment_id": string }; Returns: undefined
                           },
"publish_coding_question":
{ Args: { "p_question_id": string }; Returns: string
                           },
"save_coding_draft":
{ Args: { "p_payload": Json,"p_question_id"?: string }; Returns: Json
                           },
"save_mcq_draft":
{ Args: { "p_payload": Json,"p_question_id"?: string }; Returns: Json
                           },
"save_quiz_draft":
{ Args: { "p_assessment_id"?: string,"p_payload": Json }; Returns: string
                           },
"student_can_see_version":
{ Args: { "vid": string }; Returns: boolean
                           },
"unpublish_assessment":
{ Args: { "p_assessment_id": string }; Returns: undefined
                           },
"unpublish_question":
{ Args: { "p_archive"?: boolean,"p_question_id": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
