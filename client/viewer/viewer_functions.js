toggleDebugFeedDetails = function ( e, tmpl ) {
  items = tmpl.findAll( 'li' )
  $target = $( e.target.closest( 'li' ) )
  $targetDetails = $target.find( '.details' )

  if ( $target.hasClass( 'expanded' ) ) {
    $($targetDetails).animate( { "height" : 0, "margin-top" : "-0.5em" }, 200 );
    $target.removeClass( 'expanded' )
  } else {
    $target.addClass( 'expanded' )
    $( $targetDetails ).animate( { "height" : $( $targetDetails ).get( 0 ).scrollHeight, "margin-top" : "0.6em" }, 200 );
  }
}
