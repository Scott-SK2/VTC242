from rest_framework.pagination import CursorPagination as DRFCursorPagination


class CursorPagination(DRFCursorPagination):
    page_size = 20
    ordering = "-created_at"
    cursor_query_param = "cursor"
    max_page_size = 100
    page_size_query_param = "page_size"
