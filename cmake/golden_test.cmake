execute_process(COMMAND ${GEN} ${IN} ${OUT} RESULT_VARIABLE rc OUTPUT_QUIET)
if(NOT rc EQUAL 0)
	message(FATAL_ERROR "converter exited with ${rc} on ${IN}")
endif()
execute_process(COMMAND ${CMAKE_COMMAND} -E compare_files  ${GOLDEN} ${OUT}
	RESULT_VARIABLE diff)
if(NOT diff EQUAL 0)
	message(FATAL_ERROR "generated SMV differs from golden ${GOLDEN}")
endif()
